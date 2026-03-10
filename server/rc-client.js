import sql from 'mssql';

const config = {
  server: process.env.RC_HOST || '192.168.196.47',
  port: parseInt(process.env.RC_PORT || '1433'),
  database: process.env.RC_DATABASE || 'Connect',
  user: process.env.RC_USER || 'ggv_n8n',
  password: process.env.RC_PASSWORD || '',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 10000,
  requestTimeout: 30000,
};

let pool = null;

async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}

export async function testConnection() {
  const p = await getPool();
  const result = await p.request().query('SELECT 1 AS ok');
  return { connected: true, server: config.server, database: config.database };
}

export async function getSystems() {
  const p = await getPool();
  const result = await p.request().query(
    'SELECT idsys AS id, namesys AS name FROM systems ORDER BY namesys'
  );
  return result.recordset;
}

export async function getModules(systemId) {
  const p = await getPool();
  const result = await p.request()
    .input('systemId', sql.Int, systemId)
    .query('SELECT idmod AS id, namemod AS name FROM modules WHERE idsys = @systemId ORDER BY namemod');
  return result.recordset;
}

export async function getTickets(systemId, moduleId) {
  const p = await getPool();
  const req = p.request()
    .input('systemId', sql.Int, systemId);

  let moduleFilter = '';
  if (moduleId) {
    req.input('moduleId', sql.Int, moduleId);
    moduleFilter = 'AND r.module = @moduleId';
  }

  const result = await req.query(`
    SELECT
      r.id AS rc_ticket_id,
      r.e_title AS title,
      r.e_message AS description,
      r.e_name AS author,
      r.e_mail AS author_email,
      r.add_date AS created_at,
      r.change_date AS updated_at,
      s.st_name AS status_name,
      r.status AS status_id,
      u.name AS priority_name,
      r.urg AS priority_id,
      rt.TypeName AS type_name,
      r.type AS type_id,
      r.system AS system_id,
      r.module AS module_id,
      sys.namesys AS system_name,
      m.namemod AS module_name,
      r.e_deadline AS deadline,
      r.dopinfo AS extra_info
    FROM requests r
    LEFT JOIN status_st s ON s.id = r.status
    LEFT JOIN urg u ON u.id = r.urg
    LEFT JOIN RequestType rt ON rt.id = r.type
    LEFT JOIN systems sys ON sys.idsys = r.system
    LEFT JOIN modules m ON m.idmod = r.module
    WHERE r.system = @systemId
      ${moduleFilter}
      AND r.status NOT IN (5, 6, 8, 14, 15)
    ORDER BY r.add_date DESC
  `);
  return result.recordset;
}

export async function getTicket(ticketId) {
  const p = await getPool();
  const result = await p.request()
    .input('ticketId', sql.Int, ticketId)
    .query(`
      SELECT
        r.id AS rc_ticket_id,
        r.e_title AS title,
        r.e_message AS description,
        r.e_name AS author,
        r.e_mail AS author_email,
        r.add_date AS created_at,
        r.change_date AS updated_at,
        s.st_name AS status_name,
        r.status AS status_id,
        u.name AS priority_name,
        r.urg AS priority_id,
        rt.TypeName AS type_name,
        r.type AS type_id,
        r.system AS system_id,
        r.module AS module_id,
        sys.namesys AS system_name,
        m.namemod AS module_name,
        r.e_deadline AS deadline,
        r.dopinfo AS extra_info
      FROM requests r
      LEFT JOIN status_st s ON s.id = r.status
      LEFT JOIN urg u ON u.id = r.urg
      LEFT JOIN RequestType rt ON rt.id = r.type
      LEFT JOIN systems sys ON sys.idsys = r.system
      LEFT JOIN modules m ON m.idmod = r.module
      WHERE r.id = @ticketId
    `);
  return result.recordset[0] || null;
}

export async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
