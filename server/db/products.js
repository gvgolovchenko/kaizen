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

export async function create({ name, description, repo_url, tech_stack, owner, project_path, rc_system_id, rc_module_id }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (name, description, repo_url, tech_stack, owner, project_path, rc_system_id, rc_module_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [name, description || null, repo_url || null, tech_stack || null, owner || null, project_path || null, rc_system_id || null, rc_module_id || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (['name', 'description', 'repo_url', 'tech_stack', 'owner', 'status', 'project_path', 'rc_system_id', 'rc_module_id', 'automation', 'last_rc_sync_at', 'last_pipeline_at'].includes(key)) {
      if (key === 'automation') {
        sets.push(`${key} = $${i++}::jsonb`);
        vals.push(typeof value === 'string' ? value : JSON.stringify(value));
      } else {
        sets.push(`${key} = $${i++}`);
        vals.push(value);
      }
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

export async function getWithAutomation() {
  const { rows } = await pool.query(`
    SELECT p.*,
      (SELECT count(*) FROM opii.kaizen_issues i WHERE i.product_id = p.id AND i.status = 'open') AS open_issues
    FROM ${TABLE} p
    WHERE p.automation IS NOT NULL AND p.automation != '{}'::jsonb
      AND (p.automation->'rc_auto_sync'->>'enabled' = 'true' OR p.automation->'auto_pipeline'->>'enabled' = 'true')
    ORDER BY p.created_at DESC
  `);
  return rows;
}

export async function remove(id) {
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return rowCount > 0;
}
