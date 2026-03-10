import { pool } from './pool.js';

const TABLE = 'opii.kaizen_issues';

export async function getByProduct(productId, status) {
  let query = `SELECT * FROM ${TABLE} WHERE product_id = $1`;
  const params = [productId];
  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }
  query += ` ORDER BY created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create({ product_id, title, description, type, priority, rc_ticket_id }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (product_id, title, description, type, priority, rc_ticket_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [product_id, title, description || null, type || 'improvement', priority || 'medium', rc_ticket_id || null]
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
