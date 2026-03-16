/**
 * GitLab Issues sync — fetch issues from GitLab, cache in DB, import to Kaizen issues.
 */

import * as products from './db/products.js';
import * as gitlabIssues from './db/gitlab-issues.js';
import * as issues from './db/issues.js';
import { getIssues } from './gitlab-client.js';

// Label → Kaizen type mapping
const LABEL_TYPE_MAP = {
  bug: 'bug',
  'type::bug': 'bug',
  defect: 'bug',
  feature: 'feature',
  'type::feature': 'feature',
  enhancement: 'improvement',
  improvement: 'improvement',
  'type::improvement': 'improvement',
};

// Label → Kaizen priority mapping
const LABEL_PRIORITY_MAP = {
  critical: 'critical',
  'priority::critical': 'critical',
  'priority::1': 'critical',
  high: 'high',
  'priority::high': 'high',
  'priority::2': 'high',
  medium: 'medium',
  'priority::medium': 'medium',
  'priority::3': 'medium',
  low: 'low',
  'priority::low': 'low',
  'priority::4': 'low',
};

function detectType(labels) {
  for (const label of labels) {
    const key = label.toLowerCase();
    if (LABEL_TYPE_MAP[key]) return LABEL_TYPE_MAP[key];
  }
  return 'improvement';
}

function detectPriority(labels) {
  for (const label of labels) {
    const key = label.toLowerCase();
    if (LABEL_PRIORITY_MAP[key]) return LABEL_PRIORITY_MAP[key];
  }
  return 'medium';
}

/**
 * Sync issues from GitLab into local cache.
 */
export async function syncIssues(productId) {
  const product = await products.getById(productId);
  if (!product?.deploy?.gitlab?.project_id) {
    throw new Error('GitLab не настроен для этого продукта (deploy.gitlab.project_id)');
  }

  const glIssues = await getIssues(product.deploy, { state: 'opened' });

  let newCount = 0, updatedCount = 0;
  for (const issue of glIssues) {
    const result = await gitlabIssues.upsert(productId, issue);
    result.is_new ? newCount++ : updatedCount++;
  }

  return { new: newCount, updated: updatedCount, total: glIssues.length };
}

/**
 * Import a single cached GitLab issue → Kaizen issue.
 */
export async function importIssue(glIssueCacheId) {
  const glIssue = await gitlabIssues.getById(glIssueCacheId);
  if (!glIssue) throw new Error('GitLab issue not found in cache');
  if (glIssue.sync_status === 'imported') throw new Error('Issue already imported');

  const labels = Array.isArray(glIssue.labels) ? glIssue.labels : JSON.parse(glIssue.labels || '[]');

  const issue = await issues.create({
    product_id: glIssue.product_id,
    title: glIssue.title,
    description: (glIssue.description || '').slice(0, 2000) + (glIssue.web_url ? `\n\n[GitLab #${glIssue.gitlab_issue_iid}](${glIssue.web_url})` : ''),
    type: detectType(labels),
    priority: detectPriority(labels),
    gitlab_issue_id: glIssue.gitlab_issue_iid,
  });

  await gitlabIssues.updateSyncStatus(glIssueCacheId, 'imported', issue.id);
  return issue;
}

/**
 * Bulk import cached GitLab issues.
 */
export async function importBulk(glIssueCacheIds) {
  const results = [];
  for (const id of glIssueCacheIds) {
    try {
      const issue = await importIssue(id);
      results.push(issue);
    } catch { /* skip already imported */ }
  }
  return results;
}

/**
 * Auto-import by label rules.
 */
export async function autoImportByLabels(productId, labelRules = []) {
  if (!labelRules.length) return { imported: 0, tickets: [] };

  const newIssues = await gitlabIssues.getByProduct(productId, 'new');

  const matching = newIssues.filter(gi => {
    const labels = Array.isArray(gi.labels) ? gi.labels : JSON.parse(gi.labels || '[]');
    return labels.some(l => labelRules.includes(l.toLowerCase()));
  });

  const imported = [];
  for (const gi of matching) {
    try {
      const issue = await importIssue(gi.id);
      imported.push(issue);
    } catch { /* skip */ }
  }

  return { imported: imported.length, tickets: imported };
}
