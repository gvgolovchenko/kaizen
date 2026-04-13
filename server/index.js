import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';
import { pool } from './db/pool.js';
import { QueueManager } from './queue-manager.js';
import { Scheduler } from './scheduler.js';
import { ScenarioRunner } from './scenario-runner.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3034;

// Создаём QueueManager, Scheduler и ScenarioRunner
const queueManager = new QueueManager();
const scheduler = new Scheduler(queueManager);
const scenarioRunner = new ScenarioRunner(queueManager);
scheduler.scenarioRunner = scenarioRunner;

// Связка: QueueManager уведомляет Scheduler о завершении процессов
queueManager.onProcessDone = (processId, status) => {
  scheduler.onProcessComplete(processId, status);
};

app.use(helmet({ contentSecurityPolicy: false })); // CSP отключён — inline scripts в Vanilla JS фронте
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// Передаём queueManager и scheduler в router
app.locals.queueManager = queueManager;
app.set('scheduler', scheduler);
app.set('scenarioRunner', scenarioRunner);
app.use('/api', apiRouter);

// JSON error handler — always return JSON, never HTML
app.use('/api', (err, req, res, next) => {
  log.error({ method: req.method, path: req.path, err: err.message }, 'API error');
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

app.listen(PORT, async () => {
  log.info({ port: PORT }, 'Kaizen started');

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
      log.info({ orphaned: rowCount }, 'startup cleanup: orphaned processes marked as failed');
    }
    // Reset stale dev_status on releases
    const { rowCount: devCount } = await pool.query(`
      UPDATE opii.kaizen_releases
      SET dev_status = 'failed'
      WHERE dev_status = 'in_progress'`);
    if (devCount > 0) {
      log.info({ releases: devCount }, 'startup cleanup: dev_status reset to failed');
    }
  } catch (err) {
    log.error({ err: err.message }, 'startup cleanup failed');
  }

  // Восстановить очередь и запустить планировщик
  try {
    await queueManager.restoreFromDb();
    scheduler.start();
    log.info('QueueManager + Scheduler started');
  } catch (err) {
    log.error({ err: err.message }, 'QueueManager/Scheduler init failed');
  }
});

// ── Graceful shutdown ──────────────────────────────────

async function shutdown(signal) {
  log.info({ signal }, 'graceful shutdown');

  // 1. Stop Scheduler (no new ticks)
  scheduler.stop();
  log.info('Scheduler stopped');

  // 2. Mark running processes as failed (orphaned)
  try {
    const { rowCount } = await pool.query(`
      UPDATE opii.kaizen_processes
      SET status = 'failed',
          error = 'Server shutdown (${signal})',
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
      WHERE status = 'running'`);
    if (rowCount > 0) log.info({ orphaned: rowCount }, 'shutdown: running processes marked as failed');

    await pool.query(`UPDATE opii.kaizen_releases SET dev_status = 'failed' WHERE dev_status = 'in_progress'`);
  } catch (err) {
    log.error({ err: err.message }, 'shutdown cleanup error');
  }

  // 3. Close DB pool
  try {
    await pool.end();
    log.info('DB pool closed');
  } catch { /* ignore */ }

  log.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
