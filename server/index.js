import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';
import { pool } from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3034;

app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.use('/api', apiRouter);

app.listen(PORT, async () => {
  console.log(`Kaizen запущен на http://localhost:${PORT}`);

  // Startup cleanup: mark orphaned running processes as failed
  try {
    const { rowCount } = await pool.query(`
      UPDATE opii.kaizen_processes
      SET status = 'failed',
          error = 'Orphaned by server restart',
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
      WHERE status = 'running'`);
    if (rowCount > 0) {
      console.log(`Startup cleanup: ${rowCount} orphaned process(es) marked as failed`);
    }
  } catch (err) {
    console.error('Startup cleanup failed:', err.message);
  }
});
