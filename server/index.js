import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';
import { pool } from './db/pool.js';
import { QueueManager } from './queue-manager.js';
import { Scheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3034;

// Создаём QueueManager и Scheduler
const queueManager = new QueueManager();
const scheduler = new Scheduler(queueManager);

// Связка: QueueManager уведомляет Scheduler о завершении процессов
queueManager.onProcessDone = (processId, status) => {
  scheduler.onProcessComplete(processId, status);
};

app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// Передаём queueManager и scheduler в router
app.locals.queueManager = queueManager;
app.set('scheduler', scheduler);
app.use('/api', apiRouter);

// JSON error handler — always return JSON, never HTML
app.use('/api', (err, req, res, next) => {
  console.error(`API error [${req.method} ${req.path}]:`, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

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
    // Reset stale dev_status on releases
    const { rowCount: devCount } = await pool.query(`
      UPDATE opii.kaizen_releases
      SET dev_status = 'failed'
      WHERE dev_status = 'in_progress'`);
    if (devCount > 0) {
      console.log(`Startup cleanup: ${devCount} release(s) dev_status reset to failed`);
    }
  } catch (err) {
    console.error('Startup cleanup failed:', err.message);
  }

  // Восстановить очередь и запустить планировщик
  try {
    await queueManager.restoreFromDb();
    scheduler.start();
    console.log('QueueManager + Scheduler запущены');
  } catch (err) {
    console.error('QueueManager/Scheduler init failed:', err.message);
  }
});

// ── Graceful shutdown ──────────────────────────────────

async function shutdown(signal) {
  console.log(`\n${signal} received. Graceful shutdown...`);

  // 1. Stop Scheduler (no new ticks)
  scheduler.stop();
  console.log('Scheduler stopped');

  // 2. Mark running processes as failed (orphaned)
  try {
    const { rowCount } = await pool.query(`
      UPDATE opii.kaizen_processes
      SET status = 'failed',
          error = 'Server shutdown (${signal})',
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
      WHERE status = 'running'`);
    if (rowCount > 0) console.log(`Shutdown: ${rowCount} running process(es) marked as failed`);

    await pool.query(`UPDATE opii.kaizen_releases SET dev_status = 'failed' WHERE dev_status = 'in_progress'`);
  } catch (err) {
    console.error('Shutdown cleanup error:', err.message);
  }

  // 3. Close DB pool
  try {
    await pool.end();
    console.log('DB pool closed');
  } catch { /* ignore */ }

  console.log('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
