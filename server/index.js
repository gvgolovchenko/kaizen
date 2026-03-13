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
