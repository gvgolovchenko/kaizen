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
