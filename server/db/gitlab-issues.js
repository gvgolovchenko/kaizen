import { pool } from './pool.js';

const TABLE = 'opii.kaizen_gitlab_issues';

export async function getByProduct(productId, syncStatus) {
  let query = `SELECT * FROM ${TABLE} WHERE product_id = $1`;
  const params = [productId];
  if (syncStatus) {
    query += ` AND sync_status = $2`;
    params.push(syncStatus);
  }
  query += ` ORDER BY gl_created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function upsert(productId, issue) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (
      product_id, gitlab_issue_iid, gitlab_issue_id, gitlab_project_id,
      title, description, state, labels, milestone,
      author, assignees, gl_created_at, gl_updated_at, gl_closed_at,
      web_url, raw_data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (gitlab_issue_iid, product_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      state = EXCLUDED.state,
      labels = EXCLUDED.labels,
      milestone = EXCLUDED.milestone,
      author = EXCLUDED.author,
      assignees = EXCLUDED.assignees,
      gl_updated_at = EXCLUDED.gl_updated_at,
      gl_closed_at = EXCLUDED.gl_closed_at,
      web_url = EXCLUDED.web_url,
      raw_data = EXCLUDED.raw_data
    RETURNING *, (xmax = 0) AS is_new`,
    [
      productId, issue.iid, issue.id, issue.project_id,
      issue.title, issue.description || '', issue.state,
      JSON.stringify(issue.labels || []),
      issue.milestone?.title || null,
      issue.author?.name || issue.author?.username || null,
      JSON.stringify((issue.assignees || []).map(a => a.name || a.username)),
      issue.created_at, issue.updated_at, issue.closed_at,
      issue.web_url, JSON.stringify(issue),
    ]
  );
  return rows[0];
}

export async function updateSyncStatus(id, syncStatus, issueId) {
  const params = [syncStatus, id];
  let issueSet = '';
  if (issueId !== undefined) {
    issueSet = ', issue_id = $3';
    params.push(issueId);
  }
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET sync_status = $1${issueSet} WHERE id = $2 RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function countByProduct(productId) {
  const { rows } = await pool.query(
    `SELECT sync_status, count(*)::int AS count FROM ${TABLE} WHERE product_id = $1 GROUP BY sync_status`,
    [productId]
  );
  const stats = { new: 0, imported: 0, ignored: 0, total: 0 };
  for (const r of rows) {
    stats[r.sync_status] = r.count;
    stats.total += r.count;
  }
  return stats;
}
