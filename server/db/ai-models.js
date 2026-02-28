import { pool } from './pool.js';

const TABLE = 'opii.kaizen_ai_models';

export async function getAll({ provider, deployment } = {}) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (provider) {
    conditions.push(`provider = $${i++}`);
    params.push(provider);
  }
  if (deployment) {
    conditions.push(`deployment = $${i++}`);
    params.push(deployment);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLE} ${where} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create({ name, provider, deployment, model_id, description, parameters_size, context_length, api_key }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (name, provider, deployment, model_id, description, parameters_size, context_length, api_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      name,
      provider || 'ollama',
      deployment || 'local',
      model_id,
      description || '',
      parameters_size || null,
      context_length || null,
      api_key || null
    ]
  );
  return rows[0];
}

export async function update(id, fields) {
  const allowed = ['name', 'provider', 'deployment', 'model_id', 'description', 'parameters_size', 'context_length', 'status', 'api_key'];
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

export async function remove(id) {
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function updateStatus(id, status) {
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] || null;
}
