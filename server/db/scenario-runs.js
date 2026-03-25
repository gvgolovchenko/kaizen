import { pool } from './pool.js';

const TABLE = 'opii.kaizen_scenario_runs';

export async function getByScenario(scenarioId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLE}
     WHERE scenario_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [scenarioId, limit]
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(
    `SELECT r.*, s.name AS scenario_name, s.preset
     FROM ${TABLE} r
     JOIN opii.kaizen_scenarios s ON s.id = r.scenario_id
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function create({ scenario_id, trigger, config_snapshot }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (scenario_id, "trigger", config_snapshot)
     VALUES ($1, $2, $3) RETURNING *`,
    [scenario_id, trigger || 'manual', config_snapshot ? JSON.stringify(config_snapshot) : null]
  );
  return rows[0];
}

export async function updateResult(id, { status, result, error }) {
  const sets = ['status = $1'];
  const vals = [status];
  let i = 2;

  if (result !== undefined) {
    sets.push(`result = $${i++}`);
    vals.push(JSON.stringify(result));
  }
  if (error !== undefined) {
    sets.push(`error = $${i++}`);
    vals.push(error);
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    sets.push(`completed_at = $${i++}`);
    vals.push(new Date().toISOString());
  }

  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function getRunning() {
  const { rows } = await pool.query(
    `SELECT r.*, s.name AS scenario_name, s.preset, s.product_id
     FROM ${TABLE} r
     JOIN opii.kaizen_scenarios s ON s.id = r.scenario_id
     WHERE r.status = 'running'
     ORDER BY r.started_at ASC`
  );
  return rows;
}

export async function remove(id) {
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return rowCount > 0;
}
