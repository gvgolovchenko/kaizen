import { pool } from './pool.js';

/**
 * Search across products, issues, and releases.
 * @param {string} query - search term (min 2 chars)
 * @returns {Array<{type, id, title, url, meta}>}
 */
export async function search(query) {
  const q = `%${query}%`;
  const { rows } = await pool.query(`
    (SELECT 'product' AS type, id, name AS title, NULL AS meta, NULL AS product_id
     FROM opii.kaizen_products WHERE name ILIKE $1 LIMIT 5)
    UNION ALL
    (SELECT 'issue' AS type, i.id, i.title, p.name AS meta, i.product_id
     FROM opii.kaizen_issues i JOIN opii.kaizen_products p ON p.id = i.product_id
     WHERE i.title ILIKE $1 LIMIT 5)
    UNION ALL
    (SELECT 'release' AS type, r.id, r.name AS title, p.name AS meta, r.product_id
     FROM opii.kaizen_releases r JOIN opii.kaizen_products p ON p.id = r.product_id
     WHERE r.name ILIKE $1 LIMIT 5)
  `, [q]);

  return rows.map(r => ({
    type: r.type,
    id: r.id,
    title: r.title,
    meta: r.meta,
    url: r.type === 'product'
      ? `/product.html?id=${r.id}`
      : `/product.html?id=${r.product_id}`,
  }));
}
