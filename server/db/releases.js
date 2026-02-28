import { pool } from './pool.js';

const TABLE = 'opii.kaizen_releases';
const ISSUES_TABLE = 'opii.kaizen_issues';
const LINK_TABLE = 'opii.kaizen_release_issues';

export async function getByProduct(productId) {
  const { rows } = await pool.query(
    `SELECT r.*,
       (SELECT count(*) FROM ${LINK_TABLE} ri WHERE ri.release_id = r.id) AS issue_count
     FROM ${TABLE} r
     WHERE r.product_id = $1
     ORDER BY r.created_at DESC`,
    [productId]
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  const release = rows[0] || null;
  if (!release) return null;

  const issuesResult = await pool.query(
    `SELECT i.* FROM ${ISSUES_TABLE} i
     JOIN ${LINK_TABLE} ri ON ri.issue_id = i.id
     WHERE ri.release_id = $1
     ORDER BY i.created_at`,
    [id]
  );
  release.issues = issuesResult.rows;
  return release;
}

export async function create({ product_id, version, name, description, issue_ids }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO ${TABLE} (product_id, version, name, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [product_id, version, name, description || null]
    );
    const release = rows[0];

    if (issue_ids && issue_ids.length > 0) {
      for (const issueId of issue_ids) {
        await client.query(
          `INSERT INTO ${LINK_TABLE} (release_id, issue_id) VALUES ($1, $2)`,
          [release.id, issueId]
        );
        await client.query(
          `UPDATE ${ISSUES_TABLE} SET status = 'in_release' WHERE id = $1`,
          [issueId]
        );
      }
    }

    await client.query('COMMIT');
    return getById(release.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function update(id, { version, name, description, status, add_issue_ids, remove_issue_ids }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update release fields
    const sets = [];
    const vals = [];
    let i = 1;
    if (version !== undefined) { sets.push(`version = $${i++}`); vals.push(version); }
    if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
    if (description !== undefined) { sets.push(`description = $${i++}`); vals.push(description); }
    if (status !== undefined) { sets.push(`status = $${i++}`); vals.push(status); }

    if (sets.length > 0) {
      vals.push(id);
      await client.query(
        `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = $${i}`,
        vals
      );
    }

    // Add issues
    if (add_issue_ids && add_issue_ids.length > 0) {
      for (const issueId of add_issue_ids) {
        await client.query(
          `INSERT INTO ${LINK_TABLE} (release_id, issue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, issueId]
        );
        await client.query(
          `UPDATE ${ISSUES_TABLE} SET status = 'in_release' WHERE id = $1`,
          [issueId]
        );
      }
    }

    // Remove issues
    if (remove_issue_ids && remove_issue_ids.length > 0) {
      for (const issueId of remove_issue_ids) {
        await client.query(
          `DELETE FROM ${LINK_TABLE} WHERE release_id = $1 AND issue_id = $2`,
          [id, issueId]
        );
        await client.query(
          `UPDATE ${ISSUES_TABLE} SET status = 'open' WHERE id = $1`,
          [issueId]
        );
      }
    }

    await client.query('COMMIT');
    return getById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function remove(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Return issues to open status
    await client.query(
      `UPDATE ${ISSUES_TABLE} SET status = 'open'
       WHERE id IN (SELECT issue_id FROM ${LINK_TABLE} WHERE release_id = $1)`,
      [id]
    );

    const { rowCount } = await client.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    await client.query('COMMIT');
    return rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function publish(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE ${TABLE} SET status = 'released', released_at = now() WHERE id = $1`,
      [id]
    );

    await client.query(
      `UPDATE ${ISSUES_TABLE} SET status = 'done'
       WHERE id IN (SELECT issue_id FROM ${LINK_TABLE} WHERE release_id = $1)`,
      [id]
    );

    await client.query('COMMIT');
    return getById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
