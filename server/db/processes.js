import { pool } from './pool.js';

const TABLE = 'opii.kaizen_processes';

export async function getAll({ status, product_id } = {}) {
  let query = `
    SELECT p.*,
      pr.name AS product_name,
      m.name AS model_name
    FROM ${TABLE} p
    JOIN opii.kaizen_products pr ON pr.id = p.product_id
    JOIN opii.kaizen_ai_models m ON m.id = p.model_id`;
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
  return rows;
}

export async function getByProduct(productId) {
  const { rows } = await pool.query(`
    SELECT p.*,
      m.name AS model_name
    FROM ${TABLE} p
    JOIN opii.kaizen_ai_models m ON m.id = p.model_id
    WHERE p.product_id = $1
    ORDER BY p.created_at DESC`,
    [productId]
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`
    SELECT p.*,
      pr.name AS product_name,
      m.name AS model_name
    FROM ${TABLE} p
    JOIN opii.kaizen_products pr ON pr.id = p.product_id
    JOIN opii.kaizen_ai_models m ON m.id = p.model_id
    WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function create({ product_id, model_id, type, input_prompt, input_template_id, input_count, release_id }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (product_id, model_id, type, input_prompt, input_template_id, input_count, release_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [product_id, model_id, type || 'improve', input_prompt || null, input_template_id || null, input_count || 5, release_id || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (['status', 'result', 'error', 'started_at', 'completed_at', 'duration_ms', 'approved_count'].includes(key)) {
      sets.push(`${key} = $${i++}`);
      vals.push(key === 'result' ? JSON.stringify(value) : value);
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
