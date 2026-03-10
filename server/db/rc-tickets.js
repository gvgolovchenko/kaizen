import { pool } from './pool.js';

const TABLE = 'opii.kaizen_rc_tickets';

export async function getByProduct(productId, syncStatus) {
  let query = `SELECT * FROM ${TABLE} WHERE product_id = $1`;
  const params = [productId];
  if (syncStatus) {
    query += ` AND sync_status = $2`;
    params.push(syncStatus);
  }
  query += ` ORDER BY rc_created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getByRcTicketId(rcTicketId, productId) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLE} WHERE rc_ticket_id = $1 AND product_id = $2`,
    [rcTicketId, productId]
  );
  return rows[0] || null;
}

export async function upsert(productId, ticket) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (
      product_id, rc_ticket_id, rc_system_id, rc_module_id,
      title, description, rc_status, rc_status_id,
      rc_priority, rc_priority_id, rc_type, rc_type_id,
      rc_author, rc_author_email, rc_created_at, rc_updated_at, rc_deadline, raw_data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (rc_ticket_id, product_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      rc_status = EXCLUDED.rc_status,
      rc_status_id = EXCLUDED.rc_status_id,
      rc_priority = EXCLUDED.rc_priority,
      rc_priority_id = EXCLUDED.rc_priority_id,
      rc_type = EXCLUDED.rc_type,
      rc_type_id = EXCLUDED.rc_type_id,
      rc_author = EXCLUDED.rc_author,
      rc_author_email = EXCLUDED.rc_author_email,
      rc_updated_at = EXCLUDED.rc_updated_at,
      rc_deadline = EXCLUDED.rc_deadline,
      raw_data = EXCLUDED.raw_data
    RETURNING *, (xmax = 0) AS is_new`,
    [
      productId, ticket.rc_ticket_id, ticket.system_id, ticket.module_id,
      ticket.title, ticket.description, ticket.status_name, ticket.status_id,
      ticket.priority_name, ticket.priority_id, ticket.type_name, ticket.type_id,
      ticket.author, ticket.author_email, ticket.created_at, ticket.updated_at,
      ticket.deadline, JSON.stringify(ticket)
    ]
  );
  return rows[0];
}

export async function updateSyncStatus(id, syncStatus, issueId) {
  const params = [syncStatus, id];
  let issueSet = '';
  if (issueId !== undefined) {
    issueSet = ', issue_id = $3';
    params.push(issueId);
  }
  const { rows } = await pool.query(
    `UPDATE ${TABLE} SET sync_status = $1${issueSet} WHERE id = $2 RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function countByProduct(productId) {
  const { rows } = await pool.query(
    `SELECT sync_status, count(*)::int AS count FROM ${TABLE} WHERE product_id = $1 GROUP BY sync_status`,
    [productId]
  );
  const stats = { new: 0, imported: 0, ignored: 0, closed_in_rc: 0, total: 0 };
  for (const r of rows) {
    stats[r.sync_status] = r.count;
    stats.total += r.count;
  }
  return stats;
}
