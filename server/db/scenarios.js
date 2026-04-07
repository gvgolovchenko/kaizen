import { pool } from './pool.js';

const TABLE = 'opii.kaizen_scenarios';

export async function getAll({ enabled, product_id } = {}) {
  let query = `
    SELECT s.*,
      pr.name AS product_name,
      (SELECT COUNT(*) FROM opii.kaizen_scenario_runs r WHERE r.scenario_id = s.id) AS run_count,
      (SELECT COUNT(*) FROM opii.kaizen_scenario_runs r WHERE r.scenario_id = s.id AND r.status = 'running') AS active_runs,
      lr.status AS last_run_status,
      lr.completed_at AS last_run_completed_at,
      lr.result->>'summary' AS last_run_summary
    FROM ${TABLE} s
    LEFT JOIN opii.kaizen_products pr ON pr.id = s.product_id
    LEFT JOIN LATERAL (
      SELECT r2.status, r2.completed_at, r2.result
      FROM opii.kaizen_scenario_runs r2
      WHERE r2.scenario_id = s.id
      ORDER BY r2.started_at DESC LIMIT 1
    ) lr ON true`;
  const params = [];
  const conditions = [];

  if (enabled !== undefined) {
    params.push(enabled);
    conditions.push(`s.enabled = $${params.length}`);
  }
  if (product_id) {
    params.push(product_id);
    conditions.push(`s.product_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY s.created_at DESC';

  const { rows } = await pool.query(query, params);
  return rows.map(r => ({
    ...r,
    run_count: parseInt(r.run_count) || 0,
    active_runs: parseInt(r.active_runs) || 0,
  }));
}

export async function getByProduct(productId) {
  const { rows } = await pool.query(
    `SELECT s.*,
      (SELECT COUNT(*) FROM opii.kaizen_scenario_runs r WHERE r.scenario_id = s.id) AS run_count,
      (SELECT COUNT(*) FROM opii.kaizen_scenario_runs r WHERE r.scenario_id = s.id AND r.status = 'running') AS active_runs
    FROM ${TABLE} s
    WHERE s.product_id = $1
    ORDER BY s.created_at DESC`,
    [productId]
  );
  return rows.map(r => ({
    ...r,
    run_count: parseInt(r.run_count) || 0,
    active_runs: parseInt(r.active_runs) || 0,
  }));
}

export async function getById(id) {
  const { rows } = await pool.query(
    `SELECT s.*, pr.name AS product_name
     FROM ${TABLE} s
     LEFT JOIN opii.kaizen_products pr ON pr.id = s.product_id
     WHERE s.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function create({ name, description, product_id, preset, config, cron, enabled }) {
  const nextRun = cron ? calcNextRun(cron) : null;
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (name, description, product_id, preset, config, cron, enabled, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [name, description || null, product_id || null, preset || 'full_cycle',
     JSON.stringify(config || {}), cron || null, enabled !== false, nextRun]
  );
  return rows[0];
}

export async function update(id, fields) {
  const allowed = ['name', 'description', 'product_id', 'preset', 'config', 'cron', 'enabled'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${i++}`);
      vals.push(key === 'config' ? JSON.stringify(value) : value);
    }
  }
  if (sets.length === 0) return getById(id);

  // Recalculate next_run_at if cron changed
  if ('cron' in fields) {
    sets.push(`next_run_at = $${i++}`);
    vals.push(fields.cron ? calcNextRun(fields.cron) : null);
  }

  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function updateRunInfo(id, { last_run_at, next_run_at }) {
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET last_run_at = $1, next_run_at = $2 WHERE id = $3 RETURNING *`,
    [last_run_at, next_run_at, id]
  );
  return rows[0] || null;
}

export async function remove(id) {
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return rowCount > 0;
}

/**
 * Получить сценарии, готовые к cron-запуску (enabled + cron + next_run_at <= NOW).
 */
export async function getDueScenarios() {
  // Атомарно: SELECT + сразу обнуляем next_run_at, чтобы параллельный запрос не нашёл тот же сценарий
  const { rows } = await pool.query(`
    WITH due AS (
      SELECT s.id
      FROM ${TABLE} s
      WHERE s.enabled = true
        AND s.cron IS NOT NULL
        AND s.next_run_at IS NOT NULL
        AND s.next_run_at <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM opii.kaizen_scenario_runs r
          WHERE r.scenario_id = s.id AND r.status = 'running'
        )
      ORDER BY s.next_run_at ASC
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE ${TABLE} s SET next_run_at = NULL
      FROM due WHERE s.id = due.id
      RETURNING s.*
    )
    SELECT c.*, pr.name AS product_name
    FROM claimed c
    LEFT JOIN opii.kaizen_products pr ON pr.id = c.product_id`
  );
  return rows;
}

// ── Cron parsing (простой, без библиотеки) ──────────────────

/**
 * Вычислить следующий запуск по cron-выражению.
 * Поддержка: минуты, часы, день месяца, месяц, день недели.
 */
export function calcNextRun(cronExpr, from = new Date()) {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const [minSpec, hourSpec, domSpec, monSpec, dowSpec] = parts;

    const parseField = (spec, min, max) => {
      if (spec === '*') return null; // any
      const values = new Set();
      for (const part of spec.split(',')) {
        if (part.includes('-')) {
          const [a, b] = part.split('-').map(Number);
          for (let v = a; v <= b; v++) values.add(v);
        } else if (part.includes('/')) {
          const [base, step] = part.split('/');
          const start = base === '*' ? min : Number(base);
          for (let v = start; v <= max; v += Number(step)) values.add(v);
        } else {
          values.add(Number(part));
        }
      }
      return [...values].sort((a, b) => a - b);
    };

    const mins = parseField(minSpec, 0, 59);
    const hours = parseField(hourSpec, 0, 23);
    const doms = parseField(domSpec, 1, 31);
    const mons = parseField(monSpec, 1, 12);
    const dows = parseField(dowSpec, 0, 6);

    const matches = (d) => {
      if (mins && !mins.includes(d.getMinutes())) return false;
      if (hours && !hours.includes(d.getHours())) return false;
      if (doms && !doms.includes(d.getDate())) return false;
      if (mons && !mons.includes(d.getMonth() + 1)) return false;
      if (dows && !dows.includes(d.getDay())) return false;
      return true;
    };

    // Перебираем минуты вперёд (макс 7 дней) в локальном времени (MSK)
    const candidate = new Date(from);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);
    const limit = 7 * 24 * 60; // 7 дней в минутах

    for (let i = 0; i < limit; i++) {
      if (matches(candidate)) return candidate.toISOString();
      candidate.setMinutes(candidate.getMinutes() + 1);
    }
    return null;
  } catch {
    return null;
  }
}
