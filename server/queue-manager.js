import * as processes from './db/processes.js';
import * as aiModels from './db/ai-models.js';
import { runProcess } from './process-runner.js';

/**
 * QueueManager — контроль параллелизма AI-процессов по провайдерам.
 * Singleton. Каждый провайдер имеет лимит одновременных запусков.
 */
export class QueueManager {
  constructor() {
    this.concurrencyLimits = {
      ollama: 1,
      mlx: 1,
      'claude-code': 2,
      anthropic: 3,
      openai: 3,
      google: 3,
      local: 3,
    };
    this.activeCount = new Map();    // provider → number
    this.onProcessDone = null;       // callback(processId, status) — для Scheduler
  }

  _getLimit(provider) {
    return this.concurrencyLimits[provider] ?? 2;
  }

  _getActive(provider) {
    return this.activeCount.get(provider) || 0;
  }

  /**
   * Поставить процесс в очередь или запустить сразу (если есть свободный слот).
   * @returns {{ queued: boolean, position?: number }}
   */
  async enqueue(processId, { timeoutMs } = {}) {
    // Загрузить процесс и модель
    const proc = await processes.getById(processId);
    if (!proc) throw new Error(`Process ${processId} not found`);

    let provider = 'local';
    if (proc.model_id) {
      const model = await aiModels.getById(proc.model_id);
      if (!model) throw new Error(`Model ${proc.model_id} not found`);
      provider = model.provider;
    }
    const active = this._getActive(provider);
    const limit = this._getLimit(provider);

    if (active < limit) {
      // Свободный слот — запускаем сразу
      this._execute(processId, provider, { timeoutMs });
      return { queued: false };
    }

    // Ставим в очередь
    await processes.update(processId, { status: 'queued' });
    const position = await processes.getQueuePosition(processId);
    return { queued: true, position };
  }

  /**
   * Запустить процесс, отслеживая счётчик активных.
   */
  async _execute(processId, provider, { timeoutMs } = {}) {
    this.activeCount.set(provider, this._getActive(provider) + 1);
    try {
      await runProcess(processId, { timeoutMs });
    } catch (err) {
      console.error(`QueueManager: process ${processId} error:`, err.message);
    } finally {
      this.activeCount.set(provider, Math.max(0, this._getActive(provider) - 1));

      // Уведомить scheduler о завершении
      const proc = await processes.getById(processId);
      const status = proc?.status || 'failed';
      if (this.onProcessDone) {
        try { this.onProcessDone(processId, status); } catch {}
      }

      // Попробовать запустить следующий из очереди
      this._dequeueNext(provider);
    }
  }

  /**
   * Взять следующий queued-процесс для данного провайдера и запустить.
   */
  async _dequeueNext(provider) {
    const active = this._getActive(provider);
    const limit = this._getLimit(provider);
    if (active >= limit) return;

    const next = provider === 'local'
      ? await processes.getNextQueuedLocal()
      : await processes.getNextQueued(provider);
    if (!next) return;

    this._execute(next.id, provider, { timeoutMs: 20 * 60 * 1000 });
  }

  /**
   * Статистика по провайдерам: active, queued, limit.
   */
  async getStats() {
    const { pool } = await import('./db/pool.js');
    const { rows } = await pool.query(`
      SELECT COALESCE(m.provider, 'local') AS provider,
        COUNT(*) FILTER (WHERE p.status = 'running') AS running,
        COUNT(*) FILTER (WHERE p.status = 'queued') AS queued
      FROM opii.kaizen_processes p
      LEFT JOIN opii.kaizen_ai_models m ON m.id = p.model_id
      WHERE p.status IN ('running', 'queued')
      GROUP BY COALESCE(m.provider, 'local')
    `);

    const stats = {};
    for (const [provider, limit] of Object.entries(this.concurrencyLimits)) {
      const row = rows.find(r => r.provider === provider);
      stats[provider] = {
        active: this._getActive(provider),
        queued: row ? parseInt(row.queued) : 0,
        limit,
      };
    }
    return stats;
  }

  /**
   * Позиция процесса в очереди (1-based) или null если не в очереди.
   */
  async getQueuePosition(processId) {
    return processes.getQueuePosition(processId);
  }

  /**
   * Восстановить состояние после перезапуска сервера:
   * пересчитать activeCount из running процессов, запустить queued.
   */
  async restoreFromDb() {
    const { pool } = await import('./db/pool.js');

    // Пересчитать activeCount из running процессов
    const { rows: running } = await pool.query(`
      SELECT COALESCE(m.provider, 'local') AS provider, COUNT(*) AS cnt
      FROM opii.kaizen_processes p
      LEFT JOIN opii.kaizen_ai_models m ON m.id = p.model_id
      WHERE p.status = 'running'
      GROUP BY COALESCE(m.provider, 'local')
    `);
    for (const row of running) {
      this.activeCount.set(row.provider, parseInt(row.cnt));
    }

    // Попробовать запустить queued для каждого провайдера
    for (const provider of Object.keys(this.concurrencyLimits)) {
      this._dequeueNext(provider);
    }

    const queuedCount = running.reduce((s, r) => s + parseInt(r.cnt), 0);
    if (queuedCount > 0) {
      console.log(`QueueManager restored: ${running.map(r => `${r.provider}=${r.cnt}`).join(', ')}`);
    }
  }

  /**
   * Отменить queued-процесс.
   */
  async cancel(processId) {
    const proc = await processes.getById(processId);
    if (!proc) throw new Error('Process not found');
    if (proc.status !== 'queued') throw new Error('Process is not queued');

    await processes.update(processId, {
      status: 'failed',
      error: 'Cancelled by user',
      completed_at: new Date().toISOString(),
    });
    return { ok: true };
  }
}
