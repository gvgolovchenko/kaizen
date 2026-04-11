/**
 * GitLab Issues sync — fetch issues from GitLab, cache in DB, import to Kaizen issues.
 */

import * as products from './db/products.js';
import * as gitlabIssues from './db/gitlab-issues.js';
import * as issues from './db/issues.js';
import { getIssues, resolveGitlabProjectId } from './gitlab-client.js';
import { createLogger } from './logger.js';

const log = createLogger('gitlab-sync');

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
 * Resolve GitLab config: use deploy.gitlab if available, otherwise auto-detect from repo_url + env.
 */
async function resolveGitlab(product) {
  if (product?.deploy?.gitlab?.project_id && product?.deploy?.gitlab?.access_token) {
    return product.deploy;
  }
  // Try auto-detect from repo_url
  const gitlabUrl = process.env.GITLAB_URL;
  const gitlabToken = process.env.GITLAB_TOKEN;
  if (!gitlabUrl || !gitlabToken || !product?.repo_url) return null;
  // Only if repo_url points to same GitLab
  if (!product.repo_url.startsWith(gitlabUrl)) return null;
  const projectId = await resolveGitlabProjectId(gitlabUrl, gitlabToken, product.repo_url);
  if (!projectId) return null;
  return {
    gitlab: { url: gitlabUrl, project_id: projectId, access_token: gitlabToken, default_branch: 'main' },
  };
}

/**
 * Sync issues from GitLab into local cache.
 */
export async function syncIssues(productId) {
  const product = await products.getById(productId);
  const deploy = await resolveGitlab(product);
  if (!deploy?.gitlab?.project_id) {
    throw new Error('GitLab не настроен для этого продукта (deploy.gitlab.project_id или repo_url)');
  }

  // Sync both opened and closed issues to keep cache up-to-date
  const [openedIssues, closedIssues] = await Promise.all([
    getIssues(deploy, { state: 'opened' }),
    getIssues(deploy, { state: 'closed' }),
  ]);
  const glIssues = [...openedIssues, ...closedIssues];

  let newCount = 0, updatedCount = 0;
  for (const issue of glIssues) {
    const result = await gitlabIssues.upsert(productId, issue);
    result.is_new ? newCount++ : updatedCount++;
  }

  // Update labels in already-imported kaizen_issues
  let labelsUpdated = 0;
  try {
    const { pool } = await import('./db/pool.js');
    const { rows: linked } = await pool.query(`
      SELECT gi.gitlab_issue_iid, gi.labels AS gl_labels, i.id AS issue_id, i.labels AS issue_labels
      FROM opii.kaizen_gitlab_issues gi
      JOIN opii.kaizen_issues i ON i.gitlab_issue_id = gi.gitlab_issue_iid AND i.product_id = gi.product_id
      WHERE gi.product_id = $1 AND gi.sync_status = 'imported'
    `, [productId]);

    for (const row of linked) {
      const glLabels = Array.isArray(row.gl_labels) ? row.gl_labels : JSON.parse(row.gl_labels || '[]');
      const issueLabels = Array.isArray(row.issue_labels) ? row.issue_labels : JSON.parse(row.issue_labels || '[]');
      if (JSON.stringify(glLabels.sort()) !== JSON.stringify(issueLabels.sort())) {
        await issues.update(row.issue_id, { labels: glLabels });
        labelsUpdated++;
      }
    }
  } catch (err) {
    // Labels sync is best-effort
    log.error({ err: err.message }, 'Labels sync error');
  }

  return { new: newCount, updated: updatedCount, total: glIssues.length, labels_updated: labelsUpdated };
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
    labels,
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

// Priority order for min_priority filtering
const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * Auto-import by label rules (legacy — kept for backward compat).
 */
export async function autoImportByLabels(productId, labelRules = []) {
  return autoImport(productId, { label_rules: labelRules });
}

/**
 * Unified auto-import with full filtering support.
 *
 * config:
 *   import_all     {boolean}  — импортировать все новые issues без фильтра (GL1)
 *   label_rules    {string[]} — импортировать если есть хотя бы один из labels
 *   exclude_labels {string[]} — исключить если есть хотя бы один из labels (GL3)
 *   min_priority   {string}   — 'critical'|'high'|'medium'|'low' — мин. приоритет (GL4)
 */
export async function autoImport(productId, config = {}) {
  const { import_all = false, label_rules = [], exclude_labels = [], min_priority } = config;

  // Нет ни import_all, ни label_rules — ничего не делаем
  if (!import_all && !label_rules.length) return { imported: 0, tickets: [] };

  const newIssues = await gitlabIssues.getByProduct(productId, 'new');

  const matching = newIssues.filter(gi => {
    const labels = (Array.isArray(gi.labels) ? gi.labels : JSON.parse(gi.labels || '[]'))
      .map(l => l.toLowerCase());

    // GL3: exclude_labels — исключить issues с нежелательными метками
    if (exclude_labels.length > 0 && labels.some(l => exclude_labels.map(e => e.toLowerCase()).includes(l))) {
      return false;
    }

    // GL4: min_priority — проверяем приоритет через маппинг меток
    if (min_priority) {
      const detectedPriority = detectPriority(Array.isArray(gi.labels) ? gi.labels : JSON.parse(gi.labels || '[]'));
      const minLevel = PRIORITY_ORDER[min_priority] || 0;
      if ((PRIORITY_ORDER[detectedPriority] || 0) < minLevel) return false;
    }

    // GL1: import_all — берём всё прошедшее фильтры
    if (import_all) return true;

    // label_rules — должен совпасть хотя бы один label
    return labels.some(l => label_rules.map(r => r.toLowerCase()).includes(l));
  });

  const imported = [];
  for (const gi of matching) {
    try {
      const issue = await importIssue(gi.id);
      imported.push(issue);
    } catch { /* skip already imported */ }
  }

  return { imported: imported.length, tickets: imported };
}

/**
 * GL2: Закрытие Kaizen issues при закрытии связанных GL issues.
 * Ищет все imported GL issues со state='closed' и переводит
 * связанный kaizen_issue в status='done'.
 */
/**
 * GL-reopen: если GitLab-issue открыт, а Kaizen-issue закрыт (done) — возвращаем в open.
 * Используется в auto_release чтобы «воскресить» задачи после публикации релиза,
 * если они не были закрыты в GitLab.
 */
export async function reopenSyncedIssues(productId) {
  const { pool } = await import('./db/pool.js');

  const { rows } = await pool.query(`
    SELECT gi.gitlab_issue_iid, i.id AS issue_id, i.title
    FROM opii.kaizen_gitlab_issues gi
    JOIN opii.kaizen_issues i
      ON i.gitlab_issue_id = gi.gitlab_issue_iid AND i.product_id = gi.product_id
    WHERE gi.product_id = $1
      AND gi.state = 'opened'
      AND gi.sync_status = 'imported'
      AND i.status = 'done'
  `, [productId]);

  let reopenedCount = 0;
  for (const row of rows) {
    try {
      await issues.update(row.issue_id, { status: 'open' });
      reopenedCount++;
      log.info({ productId, issueId: row.issue_id, glIid: row.gitlab_issue_iid }, 'Issue reopened via GitLab sync');
    } catch (err) {
      log.error({ issueId: row.issue_id, err: err.message }, 'Failed to reopen issue');
    }
  }

  return { reopened: reopenedCount };
}

export async function closeSyncedIssues(productId) {
  const { pool } = await import('./db/pool.js');

  // Найти все GL issues которые закрыты в GitLab и связаны с открытыми Kaizen issues
  const { rows } = await pool.query(`
    SELECT gi.id AS gl_cache_id, gi.gitlab_issue_iid, i.id AS issue_id, i.title
    FROM opii.kaizen_gitlab_issues gi
    JOIN opii.kaizen_issues i
      ON i.gitlab_issue_id = gi.gitlab_issue_iid AND i.product_id = gi.product_id
    WHERE gi.product_id = $1
      AND gi.state = 'closed'
      AND gi.sync_status = 'imported'
      AND i.status NOT IN ('done', 'cancelled')
  `, [productId]);

  let closedCount = 0;
  for (const row of rows) {
    try {
      await issues.update(row.issue_id, { status: 'done' });
      closedCount++;
      log.info({ productId, issueId: row.issue_id, glIid: row.gitlab_issue_iid }, 'Issue closed via GitLab sync');
    } catch (err) {
      log.error({ issueId: row.issue_id, err: err.message }, 'Failed to close issue');
    }
  }

  return { closed: closedCount };
}
