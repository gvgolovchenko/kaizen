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
 * Ensure GitLab remote is configured in the repo, then push branch.
 * @returns {{ pushed: boolean, output: string }}
 */
export async function pushToGitlab(projectPath, branchName, deploy) {
  const authUrl = buildAuthUrl(deploy);
  if (!authUrl) {
    return { pushed: false, output: 'GitLab не настроен (нет remote_url или access_token)' };
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
  const authUrl = buildAuthUrl(deploy);
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

  // Checkout default branch, merge release branch, push
  await execFileAsync('git', ['checkout', defaultBranch], opts);
  await execFileAsync('git', ['pull', remoteName, defaultBranch], { ...opts, timeout: 120_000 }).catch(() => {});
  await execFileAsync('git', ['merge', branchName, '--no-edit'], opts);

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
 * @returns {{ status: string, web_url: string, jobs: Array }}
 */
export async function getPipelineStatus(deploy, sha) {
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

  if (!pipelines.length) {
    return { status: 'not_found', web_url: null, jobs: [] };
  }

  const pipeline = pipelines[0];

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
 * @returns {Promise<{ status: string, web_url: string, jobs: Array }>}
 */
export async function waitForPipeline(deploy, sha, { timeoutMs = 600_000, intervalMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await getPipelineStatus(deploy, sha);

    if (['success', 'failed', 'canceled', 'skipped'].includes(result.status)) {
      return result;
    }

    if (result.status === 'not_found') {
      // Pipeline may not be created yet, wait
      await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }

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
