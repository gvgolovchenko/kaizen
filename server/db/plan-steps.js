import { pool } from './pool.js';

const TABLE = 'opii.kaizen_plan_steps';

export async function getByPlan(planId) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLE} WHERE plan_id = $1 ORDER BY step_order ASC, created_at ASC`,
    [planId]
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create({ plan_id, step_order, name, model_id, process_type, input_prompt, input_template_id, input_count, release_id, timeout_min, depends_on }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (plan_id, step_order, name, model_id, process_type, input_prompt, input_template_id, input_count, release_id, timeout_min, depends_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      plan_id,
      step_order || 0,
      name || null,
      model_id,
      process_type || 'improve',
      input_prompt || null,
      input_template_id || null,
      input_count || 5,
      release_id || null,
      timeout_min || 20,
      depends_on || null,
    ]
  );
  return rows[0];
}

export async function bulkCreate(planId, steps) {
  const created = [];
  for (const step of steps) {
    const row = await create({ ...step, plan_id: planId });
    created.push(row);
  }
  return created;
}

export async function update(id, fields) {
  const allowed = ['step_order', 'name', 'model_id', 'process_type', 'input_prompt', 'input_template_id', 'input_count', 'release_id', 'timeout_min', 'depends_on', 'status', 'process_id', 'error'];
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

/**
 * Получить следующий шаг для выполнения (строго последовательно по step_order).
 * Возвращает один pending-шаг или null, если нет готовых / текущий ещё выполняется.
 * @param {string} planId
 * @param {string} onFailure — 'stop' (по умолчанию) или 'skip'
 */
export async function getNextStep(planId, onFailure = 'stop') {
  const steps = await getByPlan(planId); // отсортированы по step_order
  const hasFailed = steps.some(s => s.status === 'failed');

  for (const step of steps) {
    if (step.status === 'running') return null; // текущий шаг ещё выполняется
    if (step.status === 'failed' && onFailure === 'stop') return null;
    if (step.status !== 'pending') continue; // completed / skipped / failed(skip) — пропускаем

    const deps = step.depends_on || [];
    const depsOk = deps.every(depId => {
      const dep = steps.find(s => s.id === depId);
      return dep && (dep.status === 'completed' || (hasFailed && onFailure === 'skip'));
    });
    if (depsOk) return step; // первый готовый по step_order
    return null; // зависимость не выполнена — ждём
  }
  return null; // все завершены
}
