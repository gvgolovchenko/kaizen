import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || '192.168.178.56',
  port: parseInt(process.env.DB_PORT || '8053'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  ssl: false,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});
