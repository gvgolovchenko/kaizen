/**
 * ScenarioRunner — движок выполнения сценариев.
 *
 * Каждый пресет — это императивная логика, аналогичная MCP run_pipeline,
 * но выполняющаяся server-side с сохранением истории в scenario_runs.
 *
 * Пресеты:
 * - batch_develop: spec → develop → publish для списка релизов
 * - auto_release: form_release из open issues → spec → develop
 * - nightly_audit: improve → auto-approve → create issues (для нескольких продуктов)
 * - full_cycle / analysis: обёртка над стандартным pipeline
 */

import * as processes from './db/processes.js';
import * as releases from './db/releases.js';
import * as products from './db/products.js';
import * as issues from './db/issues.js';
import * as scenarioRuns from './db/scenario-runs.js';
import * as scenarios from './db/scenarios.js';
import { notify, getNotifyOpts } from './notifier.js';

export class ScenarioRunner {
  constructor(queueManager) {
    this.queueManager = queueManager;
  }

  /**
   * Запустить сценарий.
   * @param {object} scenario — запись из kaizen_scenarios
   * @param {string} trigger — 'manual' | 'cron'
   * @returns {object} run record
   */
  async run(scenario, trigger = 'manual') {
    const run = await scenarioRuns.create({
      scenario_id: scenario.id,
      trigger,
      config_snapshot: { ...scenario.config, preset: scenario.preset, product_id: scenario.product_id },
    });

    // Обновить last_run_at
    const nextRun = scenario.cron ? scenarios.calcNextRun(scenario.cron) : null;
    await scenarios.updateRunInfo(scenario.id, {
      last_run_at: new Date().toISOString(),
      next_run_at: nextRun,
    });

    // Запускаем асинхронно — не блокируем
    this._execute(scenario, run).catch(err => {
      console.error(`ScenarioRunner: run ${run.id} crashed:`, err.message);
      scenarioRuns.updateResult(run.id, {
        status: 'failed',
        error: err.message,
      }).catch(() => {});
    });

    return run;
  }

  async _execute(scenario, run) {
    const config = scenario.config || {};
    const preset = scenario.preset;

    console.log(`ScenarioRunner: starting ${preset} "${scenario.name}" (run ${run.id})`);

    try {
      let result;
      switch (preset) {
        case 'batch_develop':
          result = await this._batchDevelop(scenario, config);
          break;
        case 'auto_release':
          result = await this._autoRelease(scenario, config);
          break;
        case 'nightly_audit':
          result = await this._nightlyAudit(scenario, config);
          break;
        case 'full_cycle':
        case 'analysis':
          result = await this._pipeline(scenario, config, preset);
          break;
        default:
          throw new Error(`Unknown preset: ${preset}`);
      }

      await scenarioRuns.updateResult(run.id, {
        status: 'completed',
        result,
      });

      console.log(`ScenarioRunner: run ${run.id} completed`);

      // Auto-disable one-time scheduled scenarios (cron with specific day/month)
      if (scenario.cron && /\d+\s+\d+\s+\d+\s+\d+/.test(scenario.cron)) {
        await scenarios.update(scenario.id, { enabled: false });
        console.log(`ScenarioRunner: one-time scenario "${scenario.name}" auto-disabled`);
      }

      // Notify
      const product = scenario.product_id ? await products.getById(scenario.product_id) : null;
      notify('scenario_completed', {
        scenario: scenario.name, preset,
        product: product?.name || 'Все продукты',
        summary: result.summary || '',
      }, product ? getNotifyOpts(product) : {}).catch(() => {});

    } catch (err) {
      await scenarioRuns.updateResult(run.id, {
        status: 'failed',
        error: err.message,
        result: { error: err.message },
      });

      console.error(`ScenarioRunner: run ${run.id} failed:`, err.message);

      const product = scenario.product_id ? await products.getById(scenario.product_id) : null;
      notify('scenario_failed', {
        scenario: scenario.name, preset,
        product: product?.name || 'Все продукты',
        error: err.message,
      }, product ? getNotifyOpts(product) : {}).catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Пресет: batch_develop
  //  spec → develop → (test →) publish для N релизов
  // ═══════════════════════════════════════════════════════════

  async _batchDevelop(scenario, config) {
    const { release_ids, model_id, timeout_min = 30, auto_publish = true, on_failure = 'stop' } = config;
    if (!release_ids?.length) throw new Error('release_ids required for batch_develop');
    if (!model_id) throw new Error('model_id required for batch_develop');

    const stages = [];
    const processIds = [];

    for (let i = 0; i < release_ids.length; i++) {
      const releaseId = release_ids[i];
      const release = await releases.getById(releaseId);
      if (!release) {
        stages.push({ release_id: releaseId, error: 'Release not found', skipped: true });
        if (on_failure === 'stop') throw new Error(`Release ${releaseId} not found`);
        continue;
      }

      const label = `${release.version || release.name} (${i + 1}/${release_ids.length})`;

      // Этап 1: Спецификация
      try {
        const specProc = await this._createAndWait({
          product_id: scenario.product_id,
          model_id,
          type: 'prepare_spec',
          release_id: releaseId,
        }, timeout_min);
        processIds.push(specProc.id);

        if (specProc.status !== 'completed') {
          stages.push({ release: label, stage: 'spec_failed', error: specProc.error });
          if (on_failure === 'stop') throw new Error(`Spec failed for ${label}: ${specProc.error}`);
          continue;
        }
        stages.push({ release: label, stage: 'spec_completed' });
      } catch (err) {
        stages.push({ release: label, stage: 'spec_error', error: err.message });
        if (on_failure === 'stop') throw err;
        continue;
      }

      // Этап 2: Разработка
      try {
        const devProc = await this._createAndWait({
          product_id: scenario.product_id,
          model_id,
          type: 'develop_release',
          release_id: releaseId,
          config: { auto_publish: false },
        }, timeout_min * 2);
        processIds.push(devProc.id);

        if (devProc.status !== 'completed') {
          stages.push({ release: label, stage: 'develop_failed', error: devProc.error });
          if (on_failure === 'stop') throw new Error(`Develop failed for ${label}: ${devProc.error}`);
          continue;
        }

        const devData = devProc.result || {};
        stages.push({
          release: label, stage: 'develop_completed',
          branch: devData.branch, tests_passed: devData.tests_passed,
        });

        // Этап 3: Публикация
        if (auto_publish && devData.tests_passed) {
          await releases.publish(releaseId);
          stages.push({ release: label, stage: 'published' });
        }
      } catch (err) {
        stages.push({ release: label, stage: 'develop_error', error: err.message });
        if (on_failure === 'stop') throw err;
      }
    }

    const completed = stages.filter(s => s.stage === 'published' || s.stage === 'develop_completed').length;
    return {
      stages,
      processes: processIds,
      summary: `Обработано ${release_ids.length} релизов, успешно: ${completed}`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Пресет: auto_release
  //  form_release → approve → spec → develop
  // ═══════════════════════════════════════════════════════════

  async _autoRelease(scenario, config) {
    const { model_id, max_issues = 10, auto_approve = 'all', timeout_min = 20,
            version_strategy = 'auto', develop = {} } = config;
    if (!model_id) throw new Error('model_id required for auto_release');
    if (!scenario.product_id) throw new Error('product_id required for auto_release');

    const stages = [];
    const processIds = [];

    // Проверить наличие open issues
    const openIssues = await issues.getByProduct(scenario.product_id, 'open');
    if (!openIssues || openIssues.length === 0) {
      return { stages: [{ stage: 'no_issues', message: 'Нет открытых задач' }], processes: [], summary: 'Нет открытых задач для обработки' };
    }
    stages.push({ stage: 'found_issues', count: openIssues.length });

    // Этап 1: form_release
    const formProc = await this._createAndWait({
      product_id: scenario.product_id,
      model_id,
      type: 'form_release',
      input_count: max_issues,
    }, timeout_min);
    processIds.push(formProc.id);

    if (formProc.status !== 'completed') {
      throw new Error(`form_release failed: ${formProc.error}`);
    }
    const proposed = formProc.result || [];
    if (!proposed.length) {
      return { stages: [{ stage: 'no_releases_proposed' }], processes: processIds, summary: 'AI не предложил релизов' };
    }
    stages.push({ stage: 'releases_proposed', count: proposed.length });

    // Этап 2: Утвердить первый предложенный релиз
    const firstRelease = proposed[0];
    const version = firstRelease.version || await this._autoVersion(scenario.product_id, version_strategy);

    // Создать релиз вручную из issue_ids
    const releaseIssueIds = (firstRelease.issues || []).map(i => i.id || i.issue_id).filter(Boolean);
    if (releaseIssueIds.length === 0) {
      // Fallback: если issues — это titles, берём первые N open issues
      const idsToUse = openIssues.slice(0, max_issues).map(i => i.id);
      releaseIssueIds.push(...idsToUse);
    }

    const release = await releases.create({
      product_id: scenario.product_id,
      version,
      name: firstRelease.name || `Авто-релиз ${version}`,
      issue_ids: releaseIssueIds,
    });
    stages.push({ stage: 'release_created', release_id: release.id, version, issues: releaseIssueIds.length });

    // Этап 3: Спецификация
    const specProc = await this._createAndWait({
      product_id: scenario.product_id,
      model_id,
      type: 'prepare_spec',
      release_id: release.id,
    }, timeout_min);
    processIds.push(specProc.id);

    if (specProc.status !== 'completed') {
      stages.push({ stage: 'spec_failed', error: specProc.error });
      return { stages, processes: processIds, summary: `Релиз ${version} создан, спецификация не удалась` };
    }
    stages.push({ stage: 'spec_completed' });

    // Этап 4: Разработка (если включено)
    if (develop.enabled !== false) {
      const devModelId = develop.model_id || model_id;
      const devProc = await this._createAndWait({
        product_id: scenario.product_id,
        model_id: devModelId,
        type: 'develop_release',
        release_id: release.id,
        config: { auto_publish: develop.auto_publish || false },
      }, (develop.timeout_min || timeout_min) * 2);
      processIds.push(devProc.id);

      if (devProc.status === 'completed') {
        const devData = devProc.result || {};
        stages.push({ stage: 'develop_completed', branch: devData.branch, tests_passed: devData.tests_passed });

        if (develop.auto_publish && devData.tests_passed) {
          await releases.publish(release.id);
          stages.push({ stage: 'published' });
        }
      } else {
        stages.push({ stage: 'develop_failed', error: devProc.error });
      }
    }

    return {
      stages,
      processes: processIds,
      release_id: release.id,
      summary: `Релиз ${version} — ${stages[stages.length - 1].stage}`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Пресет: nightly_audit
  //  improve → auto-approve → create issues (мульти-продукт)
  // ═══════════════════════════════════════════════════════════

  async _nightlyAudit(scenario, config) {
    const { model_id, template_id = 'general', count = 5,
            auto_approve = 'high_and_critical', timeout_min = 20 } = config;
    if (!model_id) throw new Error('model_id required for nightly_audit');

    // Определить продукты для аудита
    let productIds;
    if (scenario.product_id) {
      productIds = [scenario.product_id];
    } else if (config.product_ids?.length) {
      productIds = config.product_ids;
    } else {
      // Только активные продукты
      const allProducts = await products.getAll();
      productIds = allProducts.filter(p => p.status === 'active').map(p => p.id);
    }

    const stages = [];
    const processIds = [];
    let totalCreated = 0;

    for (const productId of productIds) {
      const product = await products.getById(productId);
      if (!product || product.status !== 'active') continue;

      const label = product.name;

      try {
        // Improve
        const proc = await this._createAndWait({
          product_id: productId,
          model_id,
          type: 'improve',
          input_template_id: template_id,
          input_count: count,
        }, timeout_min);
        processIds.push(proc.id);

        if (proc.status !== 'completed') {
          stages.push({ product: label, stage: 'improve_failed', error: proc.error });
          continue;
        }

        const suggestions = proc.result || [];
        stages.push({ product: label, stage: 'improve_completed', suggestions: suggestions.length });

        // Auto-approve
        if (suggestions.length > 0 && auto_approve !== 'none') {
          let indicesToApprove = [];
          if (auto_approve === 'all') {
            indicesToApprove = suggestions.map((_, i) => i);
          } else if (auto_approve === 'high_and_critical') {
            indicesToApprove = suggestions.map((s, i) => ['high', 'critical'].includes(s.priority) ? i : null).filter(i => i !== null);
          } else if (auto_approve === 'critical_only') {
            indicesToApprove = suggestions.map((s, i) => s.priority === 'critical' ? i : null).filter(i => i !== null);
          }

          if (indicesToApprove.length > 0) {
            // Создать issues через прямой вызов approve
            const approveResult = await this._approveProcess(proc.id, indicesToApprove);
            totalCreated += approveResult.count || 0;
            stages.push({ product: label, stage: 'approved', count: approveResult.count });
          }
        }
      } catch (err) {
        stages.push({ product: label, stage: 'error', error: err.message });
      }
    }

    return {
      stages,
      processes: processIds,
      summary: `Аудит ${productIds.length} продуктов, создано ${totalCreated} задач`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Пресет: full_cycle / analysis (обёртка pipeline)
  // ═══════════════════════════════════════════════════════════

  async _pipeline(scenario, config, preset) {
    const { model_id, template_id = 'general', count = 5,
            auto_approve = 'high_and_critical', timeout_min = 20,
            version, release_name, develop = {}, press_release = {} } = config;
    if (!model_id) throw new Error('model_id required');
    if (!scenario.product_id) throw new Error('product_id required');

    const stages = [];
    const processIds = [];

    const effectiveDevelop = preset === 'full_cycle'
      ? { enabled: true, auto_publish: true, ...develop }
      : develop;
    const effectivePR = preset === 'full_cycle'
      ? { enabled: true, ...press_release }
      : press_release;

    // Этап 1: Improve
    const improveProc = await this._createAndWait({
      product_id: scenario.product_id,
      model_id: config.improve?.model_id || model_id,
      type: 'improve',
      input_template_id: template_id,
      input_count: count,
    }, timeout_min);
    processIds.push(improveProc.id);

    if (improveProc.status !== 'completed') {
      throw new Error(`improve failed: ${improveProc.error}`);
    }
    const suggestions = improveProc.result || [];
    stages.push({ stage: 'improve_completed', suggestions: suggestions.length });

    // Этап 2: Auto-approve
    let indicesToApprove = [];
    if (auto_approve === 'all') {
      indicesToApprove = suggestions.map((_, i) => i);
    } else if (auto_approve === 'high_and_critical') {
      indicesToApprove = suggestions.map((s, i) => ['high', 'critical'].includes(s.priority) ? i : null).filter(i => i !== null);
    } else if (auto_approve === 'critical_only') {
      indicesToApprove = suggestions.map((s, i) => s.priority === 'critical' ? i : null).filter(i => i !== null);
    }

    if (indicesToApprove.length === 0) {
      return { stages, processes: processIds, summary: 'Нет предложений для утверждения' };
    }
    const approved = await this._approveProcess(improveProc.id, indicesToApprove);
    stages.push({ stage: 'approved', count: approved.count });

    // Этап 3: Создание релиза
    const resolvedVersion = version || await this._autoVersion(scenario.product_id);
    const issueIds = (approved.created || []).map(i => i.id);
    const release = await releases.create({
      product_id: scenario.product_id,
      version: resolvedVersion,
      name: release_name || `Релиз ${resolvedVersion}`,
      issue_ids: issueIds,
    });
    stages.push({ stage: 'release_created', release_id: release.id, version: resolvedVersion });

    // Этап 4: Спецификация
    const specProc = await this._createAndWait({
      product_id: scenario.product_id,
      model_id: config.spec?.model_id || model_id,
      type: 'prepare_spec',
      release_id: release.id,
    }, timeout_min);
    processIds.push(specProc.id);

    if (specProc.status !== 'completed') {
      stages.push({ stage: 'spec_failed', error: specProc.error });
      return { stages, processes: processIds, release_id: release.id, summary: `Спецификация не удалась` };
    }
    stages.push({ stage: 'spec_completed' });

    // Этап 5: Разработка
    if (effectiveDevelop.enabled) {
      const devProc = await this._createAndWait({
        product_id: scenario.product_id,
        model_id: effectiveDevelop.model_id || model_id,
        type: 'develop_release',
        release_id: release.id,
        config: { auto_publish: false },
      }, (effectiveDevelop.timeout_min || timeout_min) * 2);
      processIds.push(devProc.id);

      if (devProc.status === 'completed') {
        const devData = devProc.result || {};
        stages.push({ stage: 'develop_completed', branch: devData.branch, tests_passed: devData.tests_passed });

        // Публикация
        if (effectiveDevelop.auto_publish && devData.tests_passed) {
          await releases.publish(release.id);
          stages.push({ stage: 'published' });
        }

        // Пресс-релиз
        if (effectivePR.enabled && devData.tests_passed) {
          const prProc = await this._createAndWait({
            product_id: scenario.product_id,
            model_id: effectivePR.model_id || model_id,
            type: 'prepare_press_release',
            release_id: release.id,
          }, timeout_min);
          processIds.push(prProc.id);
          stages.push({ stage: prProc.status === 'completed' ? 'press_release_completed' : 'press_release_failed' });
        }
      } else {
        stages.push({ stage: 'develop_failed', error: devProc.error });
      }
    }

    const lastStage = stages[stages.length - 1].stage;
    return {
      stages,
      processes: processIds,
      release_id: release.id,
      summary: `Релиз ${resolvedVersion} — ${lastStage}`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Создать процесс, поставить в очередь, дождаться завершения.
   */
  async _createAndWait(processData, timeoutMin = 20) {
    const proc = await processes.create(processData);
    const timeoutMs = timeoutMin * 60 * 1000;
    await this.queueManager.enqueue(proc.id, { timeoutMs });

    // Polling
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      const current = await processes.getById(proc.id);
      if (!current || ['completed', 'failed'].includes(current.status)) {
        return current || proc;
      }
    }

    // Timeout
    return { ...proc, status: 'failed', error: 'Scenario runner timeout' };
  }

  /**
   * Утвердить предложения процесса.
   */
  async _approveProcess(processId, indices) {
    const proc = await processes.getById(processId);
    if (!proc || !proc.result) return { count: 0, created: [] };

    const suggestions = Array.isArray(proc.result) ? proc.result : [];
    const created = [];

    for (const idx of indices) {
      const s = suggestions[idx];
      if (!s) continue;
      try {
        const issue = await issues.create({
          product_id: proc.product_id,
          title: s.title,
          description: s.description || '',
          type: s.type || 'feature',
          priority: s.priority || 'medium',
        });
        created.push(issue);
      } catch {
        // skip duplicates
      }
    }

    // Обновить approved_count/indices
    await processes.update(processId, {
      approved_count: created.length,
      approved_indices: JSON.stringify(indices),
    });

    return { count: created.length, created };
  }

  /**
   * Авто-версия: берёт последнюю и бампит minor.
   */
  async _autoVersion(productId, strategy) {
    const allReleases = await releases.getByProduct(productId);
    if (!allReleases?.length) return '1.0.0';

    const versions = allReleases
      .map(r => r.version)
      .filter(v => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => {
        const [aMaj, aMin, aPat] = a.split('.').map(Number);
        const [bMaj, bMin, bPat] = b.split('.').map(Number);
        return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat);
      });

    if (!versions.length) return '1.0.0';
    const [maj, min] = versions[0].split('.').map(Number);
    return `${maj}.${min + 1}.0`;
  }
}
