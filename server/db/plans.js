import { pool } from './pool.js';

const TABLE = 'opii.kaizen_plans';

export async function getAll({ status, product_id } = {}) {
  let query = `
    SELECT p.*,
      pr.name AS product_name,
      (SELECT COUNT(*) FROM opii.kaizen_plan_steps s WHERE s.plan_id = p.id) AS step_count,
      (SELECT COUNT(*) FROM opii.kaizen_plan_steps s WHERE s.plan_id = p.id AND s.status = 'completed') AS completed_steps
    FROM ${TABLE} p
    JOIN opii.kaizen_products pr ON pr.id = p.product_id`;
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (product_id) {
    params.push(product_id);
    conditions.push(`p.product_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY p.created_at DESC';

  const { rows } = await pool.query(query, params);
  return rows.map(r => ({
    ...r,
    step_count: parseInt(r.step_count) || 0,
    completed_steps: parseInt(r.completed_steps) || 0,
  }));
}

export async function getByProduct(productId) {
  const { rows } = await pool.query(
    `SELECT p.*,
      (SELECT COUNT(*) FROM opii.kaizen_plan_steps s WHERE s.plan_id = p.id) AS step_count,
      (SELECT COUNT(*) FROM opii.kaizen_plan_steps s WHERE s.plan_id = p.id AND s.status = 'completed') AS completed_steps
    FROM ${TABLE} p
    WHERE p.product_id = $1
    ORDER BY p.created_at DESC`,
    [productId]
  );
  return rows.map(r => ({
    ...r,
    step_count: parseInt(r.step_count) || 0,
    completed_steps: parseInt(r.completed_steps) || 0,
  }));
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create({ name, description, product_id, on_failure, is_template, scheduled_at }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (name, description, product_id, on_failure, is_template, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, description || null, product_id, on_failure || 'stop', is_template || false, scheduled_at || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const allowed = ['name', 'description', 'on_failure', 'is_template', 'scheduled_at', 'status'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
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

export async function updateStatus(id, status, extra = {}) {
  const sets = ['status = $1'];
  const vals = [status];
  let i = 2;

  if (extra.started_at) {
    sets.push(`started_at = $${i++}`);
    vals.push(extra.started_at);
  }
  if (extra.completed_at) {
    sets.push(`completed_at = $${i++}`);
    vals.push(extra.completed_at);
  }

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
