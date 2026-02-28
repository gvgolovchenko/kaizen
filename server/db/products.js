import { pool } from './pool.js';

const TABLE = 'opii.kaizen_products';

export async function getAll() {
  const { rows } = await pool.query(`
    SELECT p.*,
      (SELECT count(*) FROM opii.kaizen_issues i WHERE i.product_id = p.id AND i.status = 'open') AS open_issues
    FROM ${TABLE} p
    ORDER BY p.created_at DESC
  `);
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create({ name, description, repo_url, tech_stack, owner, project_path }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (name, description, repo_url, tech_stack, owner, project_path)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, description || null, repo_url || null, tech_stack || null, owner || null, project_path || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (['name', 'description', 'repo_url', 'tech_stack', 'owner', 'status', 'project_path'].includes(key)) {
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
