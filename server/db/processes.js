import { pool } from './pool.js';

const TABLE = 'opii.kaizen_processes';

export async function getAll({ status, product_id } = {}) {
  let query = `
    SELECT p.*,
      pr.name AS product_name,
      m.name AS model_name
    FROM ${TABLE} p
    JOIN opii.kaizen_products pr ON pr.id = p.product_id
    LEFT JOIN opii.kaizen_ai_models m ON m.id = p.model_id`;
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
    LEFT JOIN opii.kaizen_ai_models m ON m.id = p.model_id
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
    LEFT JOIN opii.kaizen_ai_models m ON m.id = p.model_id
    WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function create({ product_id, model_id, type, input_prompt, input_template_id, input_count, release_id, plan_step_id, config }) {
  const cols = ['product_id', 'model_id', 'type', 'input_prompt', 'input_template_id', 'input_count', 'release_id'];
  const vals = [product_id, model_id, type || 'improve', input_prompt || null, input_template_id || null, input_count || 5, release_id || null];
  let idx = vals.length;

  if (plan_step_id) {
    cols.push('plan_step_id');
    vals.push(plan_step_id);
    idx++;
  }

  // Store config as JSON in input_prompt if provided (retry info)
  if (config && !input_prompt) {
    vals[3] = JSON.stringify(config); // overwrite input_prompt slot
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  return rows[0];
}

export async function update(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (['status', 'result', 'error', 'started_at', 'completed_at', 'duration_ms', 'approved_count', 'approved_indices', 'priority', 'plan_step_id'].includes(key)) {
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

/**
 * Получить следующий queued-процесс для данного провайдера.
 * Использует FOR UPDATE SKIP LOCKED для безопасного параллельного доступа.
 */
export async function getNextQueued(provider) {
  const { rows } = await pool.query(`
    SELECT p.id
    FROM ${TABLE} p
    JOIN opii.kaizen_ai_models m ON m.id = p.model_id
    WHERE p.status = 'queued' AND m.provider = $1
    ORDER BY p.priority DESC, p.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED`,
    [provider]
  );
  return rows[0] || null;
}

/**
 * Получить следующий queued-процесс без model_id (локальные процессы: run_tests).
 */
export async function getNextQueuedLocal() {
  const { rows } = await pool.query(`
    SELECT p.id
    FROM ${TABLE} p
    WHERE p.status = 'queued' AND p.model_id IS NULL
    ORDER BY p.priority DESC, p.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED`
  );
  return rows[0] || null;
}

/**
 * Позиция процесса в очереди (1-based) или null если не в очереди.
 */
export async function getQueuePosition(processId) {
  const proc = await getById(processId);
  if (!proc || proc.status !== 'queued') return null;

  // Local processes (no model_id) — count among other local queued processes
  if (!proc.model_id) {
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS position
      FROM ${TABLE} p2
      WHERE p2.status = 'queued' AND p2.model_id IS NULL
        AND (p2.priority > $2 OR (p2.priority = $2 AND p2.created_at <= $3))
        AND p2.id != $1`,
      [processId, proc.priority || 0, proc.created_at]
    );
    return parseInt(rows[0].position) + 1;
  }

  const { rows } = await pool.query(`
    SELECT COUNT(*) AS position
    FROM ${TABLE} p2
    JOIN opii.kaizen_ai_models m ON m.id = p2.model_id
    JOIN opii.kaizen_ai_models m2 ON m2.id = $2
    WHERE p2.status = 'queued'
      AND m.provider = m2.provider
      AND (p2.priority > $3 OR (p2.priority = $3 AND p2.created_at <= $4))
      AND p2.id != $1`,
    [processId, proc.model_id, proc.priority || 0, proc.created_at]
  );
  return parseInt(rows[0].position) + 1;
}
