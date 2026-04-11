/**
 * GitLab API client for Kaizen.
 * Handles git push authentication and pipeline status tracking.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

/**
 * Build authenticated GitLab remote URL from deploy config.
 * Uses OAuth2 token in URL: https://oauth2:<token>@gitlab.example.com/group/repo.git
 */
export function buildAuthUrl(deploy) {
  const gl = deploy?.gitlab;
  if (!gl?.remote_url || !gl?.access_token) return null;

  // Convert SSH format (git@host:group/repo.git) to HTTPS if needed
  let rawUrl = gl.remote_url;
  if (rawUrl.startsWith('git@')) {
    rawUrl = rawUrl.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2');
  }
  const url = new URL(rawUrl);
  url.username = 'oauth2';
  url.password = gl.access_token;
  return url.toString();
}

/**
 * Resolve authenticated remote URL — from explicit remote_url or by fetching project info via API.
 * @returns {Promise<string|null>}
 */
async function resolveAuthUrl(deploy) {
  const gl = deploy?.gitlab;
  if (!gl?.access_token) return null;

  // Prefer explicit remote_url
  if (gl.remote_url) return buildAuthUrl(deploy);

  // Derive from url + project_id via GitLab API
  if (gl.url && gl.project_id) {
    try {
      const res = await fetch(`${gl.url}/api/v4/projects/${gl.project_id}`, {
        headers: { 'PRIVATE-TOKEN': gl.access_token },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const project = await res.json();
      const url = new URL(project.http_url_to_repo);
      url.username = 'oauth2';
      url.password = gl.access_token;
      return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Ensure GitLab remote is configured in the repo, then push branch.
 * Works with explicit remote_url or with url+project_id (resolved via API).
 * @returns {{ pushed: boolean, output: string }}
 */
export async function pushToGitlab(projectPath, branchName, deploy) {
  const authUrl = await resolveAuthUrl(deploy);
  if (!authUrl) {
    return { pushed: false, output: 'GitLab не настроен (нет access_token или url+project_id)' };
  }

  const remoteName = 'gitlab';
  const opts = { cwd: projectPath, timeout: 60_000 };

  // Check if remote exists
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', remoteName], opts);
    // Remote exists — update URL (token may have changed)
    if (stdout.trim() !== authUrl) {
      await execFileAsync('git', ['remote', 'set-url', remoteName, authUrl], opts);
    }
  } catch {
    // Remote doesn't exist — add it
    await execFileAsync('git', ['remote', 'add', remoteName, authUrl], opts);
  }

  // Push branch
  try {
    const { stdout, stderr } = await execFileAsync(
      'git', ['push', remoteName, branchName, '--force'],
      { ...opts, timeout: 120_000 }
    );
    return { pushed: true, output: (stdout + stderr).trim() };
  } catch (err) {
    return { pushed: false, output: err.message };
  }
}

/**
 * Push to default branch (merge + push for deploy).
 */
export async function pushToDefaultBranch(projectPath, branchName, deploy) {
  const authUrl = await resolveAuthUrl(deploy);
  if (!authUrl) {
    return { pushed: false, output: 'GitLab не настроен' };
  }

  const defaultBranch = deploy?.gitlab?.default_branch || 'main';
  const remoteName = 'gitlab';
  const opts = { cwd: projectPath, timeout: 60_000 };

  // Ensure remote
  try {
    await execFileAsync('git', ['remote', 'get-url', remoteName], opts);
  } catch {
    await execFileAsync('git', ['remote', 'add', remoteName, authUrl], opts);
  }
  await execFileAsync('git', ['remote', 'set-url', remoteName, authUrl], opts);

  // Fetch latest, checkout default branch, sync with remote, merge release branch
  await execFileAsync('git', ['fetch', remoteName], { ...opts, timeout: 120_000 }).catch(() => {});
  // Stash any local changes so checkout doesn't fail on modified tracked files (e.g. package-lock.json)
  await execFileAsync('git', ['stash', '--include-untracked'], opts).catch(() => {});
  await execFileAsync('git', ['checkout', defaultBranch], opts);
  // Hard reset to remote to guarantee sync (local may have diverged from manual merges)
  await execFileAsync('git', ['reset', '--hard', `${remoteName}/${defaultBranch}`], opts).catch(() => {});
  // Fetch release branch too
  await execFileAsync('git', ['fetch', remoteName, branchName], { ...opts, timeout: 60_000 }).catch(() => {});
  await execFileAsync('git', ['merge', `${remoteName}/${branchName}`, '--allow-unrelated-histories', '--no-edit'], opts);

  try {
    const { stdout, stderr } = await execFileAsync(
      'git', ['push', remoteName, defaultBranch],
      { ...opts, timeout: 120_000 }
    );
    return { pushed: true, output: (stdout + stderr).trim() };
  } catch (err) {
    return { pushed: false, output: err.message };
  }
}

/**
 * Check GitLab pipeline status via API.
 * @param {object} deploy
 * @param {string} sha - commit SHA to find pipeline for
 * @param {string} [ref] - branch name fallback (search most recent pipeline on branch created after pushTime)
 * @param {number} [pushTime] - timestamp of push (ms), used for fallback branch search
 * @returns {{ status: string, web_url: string, jobs: Array }}
 */
export async function getPipelineStatus(deploy, sha, { ref, pushTime } = {}) {
  const gl = deploy?.gitlab;
  if (!gl?.url || !gl?.project_id || !gl?.access_token) {
    throw new Error('GitLab API не настроен (url, project_id, access_token)');
  }

  const baseUrl = `${gl.url}/api/v4/projects/${gl.project_id}`;
  const headers = { 'PRIVATE-TOKEN': gl.access_token };
  const fetchOpts = { headers, signal: AbortSignal.timeout(30_000) };

  // Find pipeline by SHA
  const pipelinesRes = await fetch(`${baseUrl}/pipelines?sha=${sha}&per_page=1`, fetchOpts);
  if (!pipelinesRes.ok) throw new Error(`GitLab API: ${pipelinesRes.status} ${pipelinesRes.statusText}`);
  const pipelines = await pipelinesRes.json();

  let pipeline = pipelines[0];

  // Fallback: if not found by SHA, search by branch ref (most recent pipeline created after push)
  if (!pipeline && ref && pushTime) {
    const since = new Date(pushTime - 30_000).toISOString(); // 30s before push
    const refRes = await fetch(
      `${baseUrl}/pipelines?ref=${encodeURIComponent(ref)}&per_page=5&order_by=id&sort=desc`,
      fetchOpts
    ).catch(() => null);
    if (refRes?.ok) {
      const refPipelines = await refRes.json();
      // Find the first pipeline created after push time
      pipeline = refPipelines.find(p => new Date(p.created_at).getTime() >= pushTime - 60_000);
    }
  }

  if (!pipeline) {
    return { status: 'not_found', web_url: null, jobs: [] };
  }

  // Get jobs for the pipeline
  const jobsRes = await fetch(`${baseUrl}/pipelines/${pipeline.id}/jobs`, fetchOpts);
  const jobs = jobsRes.ok ? await jobsRes.json() : [];

  return {
    id: pipeline.id,
    status: pipeline.status, // created, pending, running, success, failed, canceled, skipped
    web_url: pipeline.web_url,
    created_at: pipeline.created_at,
    updated_at: pipeline.updated_at,
    jobs: jobs.map(j => ({ name: j.name, stage: j.stage, status: j.status, duration: j.duration })),
  };
}

/**
 * Fetch issues from GitLab project.
 * @returns {Array} List of GitLab issues
 */
export async function getIssues(deploy, { state = 'opened', per_page = 100 } = {}) {
  const gl = deploy?.gitlab;
  if (!gl?.url || !gl?.project_id || !gl?.access_token) {
    throw new Error('GitLab API не настроен (url, project_id, access_token)');
  }

  const baseUrl = `${gl.url}/api/v4/projects/${gl.project_id}`;
  const headers = { 'PRIVATE-TOKEN': gl.access_token };

  const allIssues = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${baseUrl}/issues?state=${state}&per_page=${per_page}&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitLab API: ${res.status} ${res.statusText}`);

    const issues = await res.json();
    if (issues.length === 0) break;
    allIssues.push(...issues);
    if (issues.length < per_page) break;
    page++;
  }

  return allIssues;
}

/**
 * Wait for GitLab pipeline to complete (polling).
 * @param {object} deploy
 * @param {string} sha - commit SHA
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.intervalMs]
 * @param {string} [opts.ref] - branch name for fallback search
 * @returns {Promise<{ status: string, web_url: string, jobs: Array }>}
 */
export async function waitForPipeline(deploy, sha, { timeoutMs = 600_000, intervalMs = 10_000, ref } = {}) {
  const deadline = Date.now() + timeoutMs;
  const pushTime = Date.now();

  while (Date.now() < deadline) {
    const result = await getPipelineStatus(deploy, sha, { ref, pushTime });

    if (['success', 'failed', 'canceled', 'skipped'].includes(result.status)) {
      return result;
    }

    // Pipeline not found yet — wait and retry
    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`Pipeline timeout (${Math.round(timeoutMs / 60000)} мин)`);
}

/**
 * Close a GitLab issue by IID.
 * @returns {{ closed: boolean, error?: string }}
 */
export async function closeIssue(deploy, issueIid) {
  const gl = deploy?.gitlab;
  if (!gl?.url || !gl?.project_id || !gl?.access_token) {
    return { closed: false, error: 'GitLab API не настроен' };
  }

  try {
    const res = await fetch(
      `${gl.url}/api/v4/projects/${gl.project_id}/issues/${issueIid}`,
      {
        method: 'PUT',
        headers: { 'PRIVATE-TOKEN': gl.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state_event: 'close' }),
      }
    );
    if (!res.ok) return { closed: false, error: `HTTP ${res.status}` };
    return { closed: true };
  } catch (err) {
    return { closed: false, error: err.message };
  }
}

/**
 * Add a comment (note) to a GitLab issue by IID.
 * @returns {{ commented: boolean, error?: string }}
 */
export async function commentOnIssue(deploy, issueIid, body) {
  const gl = deploy?.gitlab;
  if (!gl?.url || !gl?.project_id || !gl?.access_token) {
    return { commented: false, error: 'GitLab API не настроен' };
  }

  try {
    const res = await fetch(
      `${gl.url}/api/v4/projects/${gl.project_id}/issues/${issueIid}/notes`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': gl.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }
    );
    if (!res.ok) return { commented: false, error: `HTTP ${res.status}` };
    return { commented: true };
  } catch (err) {
    return { commented: false, error: err.message };
  }
}

/**
 * Resolve GitLab project ID from repo_url.
 * Parses path from URL and searches via GitLab API.
 * @returns {number|null} project ID or null
 */
export async function resolveGitlabProjectId(gitlabUrl, token, repoUrl) {
  try {
    // Extract path: http://gitlab.com/group/project.git → group/project
    const url = new URL(repoUrl);
    const path = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
    if (!path) return null;

    const encoded = encodeURIComponent(path);
    const res = await fetch(`${gitlabUrl}/api/v4/projects/${encoded}`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (!res.ok) return null;
    const project = await res.json();
    return project.id || null;
  } catch {
    return null;
  }
}
