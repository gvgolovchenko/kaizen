import { pool } from './pool.js';

const TABLE = 'opii.kaizen_issues';

export async function getByProduct(productId, status) {
  let query = `SELECT i.*, r.version AS release_version, r.name AS release_name
    FROM ${TABLE} i
    LEFT JOIN opii.kaizen_release_issues ri ON ri.issue_id = i.id
    LEFT JOIN opii.kaizen_releases r ON r.id = ri.release_id
    WHERE i.product_id = $1`;
  const params = [productId];
  if (status) {
    query += ` AND i.status = $2`;
    params.push(status);
  }
  query += ` ORDER BY i.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getByRelease(releaseId) {
  const { rows } = await pool.query(
    `SELECT i.* FROM ${TABLE} i
     JOIN opii.kaizen_release_issues ri ON ri.issue_id = i.id
     WHERE ri.release_id = $1`,
    [releaseId]
  );
  return rows;
}

export async function create({ product_id, title, description, type, priority, rc_ticket_id, gitlab_issue_id, labels }) {
  const cols = ['product_id', 'title', 'description', 'type', 'priority', 'rc_ticket_id'];
  const vals = [product_id, title, description || null, type || 'improvement', priority || 'medium', rc_ticket_id || null];
  let idx = vals.length;

  if (gitlab_issue_id) {
    cols.push('gitlab_issue_id');
    vals.push(gitlab_issue_id);
    idx++;
  }
  if (labels && labels.length > 0) {
    cols.push('labels');
    vals.push(JSON.stringify(labels));
    idx++;
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  return rows[0];
}

export async function update(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (['title', 'description', 'type', 'priority', 'status'].includes(key)) {
      sets.push(`${key} = $${i++}`);
      vals.push(value);
    } else if (key === 'labels') {
      sets.push(`labels = $${i++}`);
      vals.push(JSON.stringify(value));
    }
  }
  if (sets.length === 0) return getById(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function remove(id) {
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return rowCount > 0;
}
