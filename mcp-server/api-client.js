/**
 * HTTP-клиент для Kaizen REST API
 */

const BASE_URL = process.env.KAIZEN_API_URL || 'http://localhost:3034/api';

async function request(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);
  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

// ── Products ──
export const listProducts = () => request('GET', '/products');
export const getProduct = (id) => request('GET', `/products/${id}`);
export const createProduct = (body) => request('POST', '/products', body);
export const updateProduct = (id, body) => request('PUT', `/products/${id}`, body);
export const deleteProduct = (id) => request('DELETE', `/products/${id}`);

// ── Issues ──
export const listIssues = (productId, status) =>
  request('GET', `/products/${productId}/issues${status ? `?status=${status}` : ''}`);
export const getIssue = (id) => request('GET', `/issues/${id}`);
export const createIssue = (body) => request('POST', '/issues', body);
export const updateIssue = (id, body) => request('PUT', `/issues/${id}`, body);
export const deleteIssue = (id) => request('DELETE', `/issues/${id}`);

// ── Releases ──
export const listReleases = (productId) => request('GET', `/products/${productId}/releases`);
export const getRelease = (id) => request('GET', `/releases/${id}`);
export const createRelease = (body) => request('POST', '/releases', body);
export const updateRelease = (id, body) => request('PUT', `/releases/${id}`, body);
export const deleteRelease = (id) => request('DELETE', `/releases/${id}`);
export const publishRelease = (id) => request('POST', `/releases/${id}/publish`);
export const prepareSpec = (id, body) => request('POST', `/releases/${id}/prepare-spec`, body);
export const getSpec = (id) => request('GET', `/releases/${id}/spec`);
export const developRelease = (id, body) => request('POST', `/releases/${id}/develop`, body);
export const preparePressRelease = (id, body) => request('POST', `/releases/${id}/prepare-press-release`, body);
export const getPressRelease = (id) => request('GET', `/releases/${id}/press-release`);

// ── AI Models ──
export const listModels = () => request('GET', '/ai-models');
export const getModel = (id) => request('GET', `/ai-models/${id}`);
export const discoverModels = () => request('GET', '/ai-models/discover');

// ── Processes ──
export const listProcesses = (params) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.product_id) qs.set('product_id', params.product_id);
  const q = qs.toString();
  return request('GET', `/processes${q ? `?${q}` : ''}`);
};
export const getProcess = (id) => request('GET', `/processes/${id}`);
export const createProcess = (body) => request('POST', '/processes', body);
export const getProcessLogs = (id) => request('GET', `/processes/${id}/logs`);
export const approveSuggestions = (id, indices) => request('POST', `/processes/${id}/approve`, { indices });
export const approveRoadmap = (id, releases) => request('POST', `/processes/${id}/approve-roadmap`, { releases });
export const cancelProcess = (id) => request('POST', `/processes/${id}/cancel`);
export const restartProcess = (id) => request('POST', `/processes/${id}/restart`);
export const deleteProcess = (id) => request('DELETE', `/processes/${id}`);

// ── Queue ──
export const getQueueStats = () => request('GET', '/queue/stats');

// ── Templates ──
export const listTemplates = () => request('GET', '/improve-templates');

// ── Plans ──
export const listPlans = (status) => request('GET', `/plans${status ? `?status=${status}` : ''}`);
export const getPlan = (id) => request('GET', `/plans/${id}`);
export const createPlan = (body) => request('POST', '/plans', body);
export const startPlan = (id) => request('POST', `/plans/${id}/start`);
export const cancelPlan = (id) => request('POST', `/plans/${id}/cancel`);
export const clonePlan = (id, body) => request('POST', `/plans/${id}/clone`, body);

// ── Rivc.Connect ──
export const rcTest = () => request('GET', '/rc/test');
export const rcSystems = () => request('GET', '/rc/systems');
export const rcModules = (systemId) => request('GET', `/rc/systems/${systemId}/modules`);
export const rcSync = (productId) => request('POST', `/products/${productId}/rc-sync`);
export const rcListTickets = (productId, syncStatus) =>
  request('GET', `/products/${productId}/rc-tickets${syncStatus ? `?sync_status=${syncStatus}` : ''}`);
export const rcImportTicket = (ticketId) => request('POST', `/rc-tickets/${ticketId}/import`);
export const rcImportBulk = (ticketIds) => request('POST', '/rc-tickets/import-bulk', { ticket_ids: ticketIds });
export const rcIgnoreTicket = (ticketId) => request('POST', `/rc-tickets/${ticketId}/ignore`);

// ── GitLab Issues ──
export const gitlabSync = (productId) => request('POST', `/products/${productId}/gitlab-sync`);
export const gitlabListIssues = (productId, syncStatus) =>
  request('GET', `/products/${productId}/gitlab-issues${syncStatus ? `?sync_status=${syncStatus}` : ''}`);
export const gitlabImportIssue = (issueId) => request('POST', `/gitlab-issues/${issueId}/import`);
export const gitlabImportBulk = (issueIds) => request('POST', '/gitlab-issues/import-bulk', { issue_ids: issueIds });
export const gitlabIgnoreIssue = (issueId) => request('POST', `/gitlab-issues/${issueId}/ignore`);

// ── Bulk ──
export const createIssuesBulk = (items) => request('POST', '/issues/bulk', { issues: items });
export const createPlanFromReleases = (body) => request('POST', '/plans/from-releases', body);
export const importRoadmap = (body) => request('POST', '/import-roadmap', body);
export const createPlanStepsBulk = (planId, steps) => request('POST', `/plans/${planId}/steps/bulk`, { steps });

// ── Form Release ──
export const approveReleases = (processId, releases) =>
  request('POST', `/processes/${processId}/approve-releases`, { releases });

// ── Auto-approve ──
export const approveAuto = (processId, rule) =>
  request('POST', `/processes/${processId}/approve-auto`, { rule });

// ── Notifications ──
export const sendNotify = (event, data, product_id) =>
  request('POST', '/notify', { event, data, product_id });

// ── Deploy ──
export const deployRelease = (releaseId, body) => request('POST', `/releases/${releaseId}/deploy`, body);
export const generateCI = (productId) => request('POST', `/products/${productId}/generate-ci`);
export const generateDockerfile = (productId) => request('POST', `/products/${productId}/generate-dockerfile`);
export const getPipelineStatus = (productId, sha) => request('GET', `/products/${productId}/pipeline-status?sha=${sha}`);

// ── Scenarios ──
export const listScenarios = (params) => {
  const qs = new URLSearchParams();
  if (params?.enabled !== undefined) qs.set('enabled', params.enabled);
  if (params?.product_id) qs.set('product_id', params.product_id);
  const q = qs.toString();
  return request('GET', `/scenarios${q ? `?${q}` : ''}`);
};
export const getScenario = (id) => request('GET', `/scenarios/${id}`);
export const createScenario = (body) => request('POST', '/scenarios', body);
export const updateScenario = (id, body) => request('PUT', `/scenarios/${id}`, body);
export const deleteScenario = (id) => request('DELETE', `/scenarios/${id}`);
export const runScenario = (id) => request('POST', `/scenarios/${id}/run`);
export const getScenarioRuns = (id, limit) => request('GET', `/scenarios/${id}/runs?limit=${limit || 20}`);
export const getScenarioRun = (id) => request('GET', `/scenario-runs/${id}`);
export const cancelScenarioRun = (id) => request('POST', `/scenario-runs/${id}/cancel`);
