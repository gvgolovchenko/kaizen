#!/usr/bin/env node

/**
 * Standalone pipeline runner — полный конвейер через REST API.
 * Не зависит от MCP, работает автономно.
 *
 * Usage: node scripts/run-pipeline.js [--delay-min N]
 *
 * Environment: KAIZEN_API=http://localhost:3034/api (default)
 */

const API = process.env.KAIZEN_API || 'http://localhost:3034/api';

// ── Config ──────────────────────────────────────────────
const CONFIG = {
  product_id: '1428ad97-cb4d-41fb-8a22-67708429b6db', // BLST
  model_id: '170986dc-3e01-4498-a7d3-259adbd6c2d3',   // Claude Code (Opus 4.6)
  preset: 'full_cycle',
  template_id: 'general',
  count: 5,
  auto_approve: 'high_and_critical',
  timeout_min: 30,
  version: null, // auto-detect
  release_name: null, // auto
  develop: {
    auto_publish: true,
    test_command: 'npx vitest run',
  },
  press_release: {
    channels: ['social', 'website'],
    tone: 'official',
  },
};

// ── Helpers ─────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${API}${path}`, opts);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `API ${resp.status}`);
  return data;
}

function log(stage, msg, data) {
  const ts = new Date().toLocaleTimeString('ru');
  console.log(`[${ts}] [${stage}] ${msg}`, data ? JSON.stringify(data) : '');
}

async function pollProcess(processId, timeoutMin = 30) {
  const deadline = Date.now() + timeoutMin * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const proc = await api('GET', `/processes/${processId}`);
    if (['completed', 'failed'].includes(proc.status)) return proc;
    log('poll', `process ${processId}: ${proc.status}`);
  }
  throw new Error(`Timeout waiting for process ${processId}`);
}

async function autoVersion(productId) {
  const releases = await api('GET', `/products/${productId}/releases`);
  if (!releases.length) return '1.0.0';
  const versions = releases
    .map(r => r.version)
    .filter(v => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const [am, ai, ap] = a.split('.').map(Number);
      const [bm, bi, bp] = b.split('.').map(Number);
      return (bm - am) || (bi - ai) || (bp - ap);
    });
  if (!versions.length) return '1.0.0';
  const [maj, min, pat] = versions[0].split('.').map(Number);
  return `${maj}.${min + 1}.${pat}`;
}

async function notify(event, data) {
  try {
    await api('POST', '/notify', { event, data, product_id: CONFIG.product_id });
    log('notify', `sent: ${event}`);
  } catch (err) {
    log('notify', `failed: ${err.message}`);
  }
}

// ── Pipeline ────────────────────────────────────────────

async function runPipeline() {
  const product = await api('GET', `/products/${CONFIG.product_id}`);
  log('start', `Pipeline for "${product.name}" (preset: ${CONFIG.preset})`);

  // Auto version
  const version = CONFIG.version || await autoVersion(CONFIG.product_id);
  const releaseName = CONFIG.release_name || `Релиз ${version}`;
  log('config', `version: ${version}, model: ${CONFIG.model_id}`);

  // ── 1. Improve ──
  log('1_improve', 'Creating improve process...');
  const proc = await api('POST', '/processes', {
    product_id: CONFIG.product_id,
    model_id: CONFIG.model_id,
    type: 'improve',
    template_id: CONFIG.template_id,
    count: CONFIG.count,
    timeout_min: CONFIG.timeout_min,
  });
  log('1_improve', `process ${proc.id} created, waiting...`);

  // ── 2. Wait ──
  const result = await pollProcess(proc.id, CONFIG.timeout_min);
  if (result.status !== 'completed') {
    log('2_wait', `FAILED: ${result.error || 'timeout'}`, { status: result.status });
    await notify('pipeline_failed', { product: product.name, version, stopped_at: 'improve', error: result.error || 'timeout' });
    return;
  }

  const suggestions = result.result || [];
  log('2_wait', `Improve completed: ${suggestions.length} suggestions`);

  // ── 3. Auto-approve ──
  let indicesToApprove = [];
  if (CONFIG.auto_approve === 'all') {
    indicesToApprove = suggestions.map((_, i) => i);
  } else if (CONFIG.auto_approve === 'high_and_critical') {
    indicesToApprove = suggestions
      .map((s, i) => ['high', 'critical'].includes(s.priority) ? i : null)
      .filter(i => i !== null);
  } else if (CONFIG.auto_approve === 'critical_only') {
    indicesToApprove = suggestions
      .map((s, i) => s.priority === 'critical' ? i : null)
      .filter(i => i !== null);
  }

  if (indicesToApprove.length === 0) {
    log('3_approve', 'No suggestions match approval rules, stopping');
    await notify('pipeline_failed', { product: product.name, version, stopped_at: 'approve', error: 'no matching suggestions' });
    return;
  }

  const approved = await api('POST', `/processes/${proc.id}/approve`, { indices: indicesToApprove });
  log('3_approve', `Approved ${approved.count} suggestions`, approved.created?.map(i => i.title));

  await notify('improve_completed', {
    product: product.name, product_id: product.id,
    suggestions_count: suggestions.length, approved_count: approved.count,
  });

  // ── 4. Create release ──
  const issueIds = approved.created.map(i => i.id);
  const release = await api('POST', '/releases', {
    product_id: CONFIG.product_id,
    version,
    name: releaseName,
    issue_ids: issueIds,
  });
  log('4_release', `Release ${release.id} created: v${version} (${issueIds.length} issues)`);

  // ── 5. Spec ──
  log('5_spec', 'Starting spec generation...');
  const specProc = await api('POST', `/releases/${release.id}/prepare-spec`, {
    model_id: CONFIG.model_id,
    timeout_min: CONFIG.timeout_min,
  });
  log('5_spec', `process ${specProc.id}, waiting...`);

  const specResult = await pollProcess(specProc.id, CONFIG.timeout_min);
  if (specResult.status !== 'completed') {
    log('5_spec', `FAILED: ${specResult.error || 'timeout'}`);
    await notify('pipeline_failed', { product: product.name, version, stopped_at: 'spec', error: specResult.error || 'timeout' });
    return;
  }
  log('5_spec', 'Spec completed');

  // ── 6. Develop ──
  log('6_develop', 'Starting development...');
  const devProc = await api('POST', `/releases/${release.id}/develop`, {
    model_id: CONFIG.model_id,
    timeout_min: CONFIG.timeout_min,
    auto_publish: CONFIG.develop.auto_publish,
    test_command: CONFIG.develop.test_command,
  });
  log('6_develop', `process ${devProc.id}, waiting...`);

  const devResult = await pollProcess(devProc.id, CONFIG.timeout_min);
  if (devResult.status !== 'completed') {
    log('6_develop', `FAILED: ${devResult.error || 'timeout'}`);
    await notify('develop_failed', { product: product.name, version, error: devResult.error || 'timeout' });
    await notify('pipeline_failed', { product: product.name, version, stopped_at: 'develop', error: devResult.error || 'timeout' });
    return;
  }

  const devData = devResult.result || {};
  log('6_develop', `Development completed`, {
    branch: devData.branch,
    tests_passed: devData.tests_passed,
    commit: devData.commit_hash,
  });

  // ── 7. Auto-publish ──
  // (auto-publish may have already happened in process-runner if tests passed)
  if (devData.tests_passed) {
    // Check if already published
    const releaseCheck = await api('GET', `/releases/${release.id}`);
    if (releaseCheck.status !== 'released') {
      try {
        await api('POST', `/releases/${release.id}/publish`);
        log('7_publish', `Release v${version} published`);
        await notify('release_published', {
          product: product.name, version,
          issues_count: issueIds.length, product_id: product.id,
        });
      } catch (pubErr) {
        log('7_publish', `Publish failed: ${pubErr.message}`);
      }
    } else {
      log('7_publish', 'Already published by auto-publish');
    }
  } else {
    log('7_publish', 'Skipped — tests failed');
  }

  // ── 8. Press Release ──
  if (devData.tests_passed) {
    log('8_pr', 'Starting press release...');
    try {
      const prProc = await api('POST', `/releases/${release.id}/prepare-press-release`, {
        model_id: CONFIG.model_id,
        timeout_min: CONFIG.timeout_min,
        channels: CONFIG.press_release.channels,
        tone: CONFIG.press_release.tone,
      });
      log('8_pr', `process ${prProc.id}, waiting...`);

      const prResult = await pollProcess(prProc.id, CONFIG.timeout_min);
      if (prResult.status === 'completed') {
        log('8_pr', 'Press release completed');
      } else {
        log('8_pr', `Press release failed: ${prResult.error || 'timeout'}`);
      }
    } catch (prErr) {
      log('8_pr', `Press release error: ${prErr.message}`);
    }
  }

  // ── Done ──
  log('done', `Pipeline completed for "${product.name}" v${version}`);
  await notify('pipeline_completed', {
    product: product.name, version,
    release_id: release.id, stages_count: 8, preset: CONFIG.preset,
  });
}

// ── Entry point ─────────────────────────────────────────

const args = process.argv.slice(2);
const delayIdx = args.indexOf('--delay-min');
const delayMin = delayIdx >= 0 ? parseInt(args[delayIdx + 1]) || 0 : 0;

if (delayMin > 0) {
  const runAt = new Date(Date.now() + delayMin * 60_000);
  console.log(`Pipeline scheduled at ${runAt.toLocaleTimeString('ru')} (in ${delayMin} min)`);
  setTimeout(() => {
    runPipeline().catch(err => {
      console.error('Pipeline fatal error:', err);
      notify('pipeline_failed', { product: 'BLST', version: '?', stopped_at: 'fatal', error: err.message });
    });
  }, delayMin * 60_000);
} else {
  runPipeline().catch(err => {
    console.error('Pipeline fatal error:', err);
    process.exit(1);
  });
}
