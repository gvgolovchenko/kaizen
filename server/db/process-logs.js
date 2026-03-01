import { pool } from './pool.js';

const TABLE = 'opii.kaizen_process_logs';

export async function getByProcess(processId) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLE} WHERE process_id = $1 ORDER BY created_at ASC`,
    [processId]
  );
  return rows;
}

export async function create({ process_id, step, message, data }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (process_id, step, message, data)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [process_id, step, message || null, data ? JSON.stringify(data) : null]
  );
  return rows[0];
}
