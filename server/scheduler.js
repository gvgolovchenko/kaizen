import * as plans from './db/plans.js';
import * as planSteps from './db/plan-steps.js';
import * as processes from './db/processes.js';
import * as products from './db/products.js';
import * as scenariosDb from './db/scenarios.js';
import * as rcSync from './rc-sync.js';
import * as gitlabSync from './gitlab-sync.js';
import { notify, getNotifyOpts } from './notifier.js';
import { pool } from './db/pool.js';

/**
 * Scheduler — планировщик выполнения планов и автоматизации.
 * Тикает каждые 30 сек: активирует scheduled планы, запускает ready шаги,
 * выполняет автоматизацию продуктов (RC sync, GitLab sync).
 */
export class Scheduler {
  constructor(queueManager) {
    this.queueManager = queueManager;
    this.scenarioRunner = null; // устанавливается из index.js
    this.tickInterval = 30_000;
    this._timer = null;
    this._ticking = false;       // защита от параллельных тиков
    this._automationCounter = 0; // проверяем автоматизацию каждые 2 минуты (4 тика)
    this._cleanupCounter = 0;    // очистка логов раз в 24 часа (2880 тиков по 30с)
    this._scenarioCounter = 0;   // проверяем сценарии каждую минуту (2 тика)
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), this.tickInterval);
    this.tick(); // сразу при старте
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async tick() {
    if (this._ticking) return; // предыдущий тик ещё не завершён
    this._ticking = true;
    try {
      await this._activateScheduledPlans();
      await this._processActivePlans();

      // Сценарии по cron — раз в минуту (каждые 2 тика по 30с)
      this._scenarioCounter++;
      if (this._scenarioCounter >= 2) {
        this._scenarioCounter = 0;
        await this._runDueScenarios();
      }

      // Автоматизация — раз в 2 минуты (каждые 4 тика по 30с)
      this._automationCounter++;
      if (this._automationCounter >= 4) {
        this._automationCounter = 0;
        await this._runAutomation();
      }

      // Очистка старых логов — раз в 24 часа
      this._cleanupCounter++;
      if (this._cleanupCounter >= 2880) {
        this._cleanupCounter = 0;
        await this._cleanupOldLogs();
      }
    } catch (err) {
      console.error('Scheduler tick error:', err.message);
    } finally {
      this._ticking = false;
    }
  }

  /**
   * Активировать планы, у которых scheduled_at <= NOW().
   */
  async _activateScheduledPlans() {
    try {
      const scheduled = await plans.getAll({ status: 'scheduled' });
      const now = new Date();
      for (const plan of scheduled) {
        if (plan.scheduled_at && new Date(plan.scheduled_at) <= now) {
          await plans.updateStatus(plan.id, 'active', { started_at: new Date().toISOString() });
          console.log(`Scheduler: plan ${plan.id} "${plan.name}" activated (scheduled)`);
        }
      }
    } catch (err) {
      console.error('Scheduler _activateScheduledPlans error:', err.message);
    }
  }

  /**
   * Обработать активные планы: найти ready шаги и запустить.
   */
  async _processActivePlans() {
    try {
      const activePlans = await plans.getAll({ status: 'active' });

      for (const plan of activePlans) {
        const steps = await planSteps.getByPlan(plan.id);
        const allCompleted = steps.length > 0 && steps.every(s => s.status === 'completed');
        const hasFailed = steps.some(s => s.status === 'failed');

        if (allCompleted) {
          await plans.updateStatus(plan.id, 'completed', { completed_at: new Date().toISOString() });
          console.log(`Scheduler: plan ${plan.id} "${plan.name}" completed`);
          continue;
        }

        if (hasFailed && plan.on_failure === 'stop') {
          await plans.updateStatus(plan.id, 'failed', { completed_at: new Date().toISOString() });
          console.log(`Scheduler: plan ${plan.id} "${plan.name}" failed (on_failure=stop)`);
          continue;
        }

        // Следующий шаг (строго последовательно по step_order)
        const nextStep = await planSteps.getNextStep(plan.id, plan.on_failure);
        if (nextStep) {
          await this._launchStep(plan, nextStep);
        }
      }
    } catch (err) {
      console.error('Scheduler _processActivePlans error:', err.message);
    }
  }

  /**
   * Запустить шаг плана: создать процесс и поставить в очередь.
   */
  async _launchStep(plan, step) {
    try {
      // Обновить статус шага
      await planSteps.update(step.id, { status: 'running' });

      // Создать процесс
      const proc = await processes.create({
        product_id: plan.product_id,
        model_id: step.model_id || null,
        type: step.process_type || 'improve',
        input_prompt: step.input_prompt || null,
        input_template_id: step.input_template_id || null,
        input_count: step.input_count || 5,
        release_id: step.release_id || null,
      });

      // Связать процесс с шагом
      await processes.update(proc.id, { plan_step_id: step.id });
      await planSteps.update(step.id, { process_id: proc.id });

      // Поставить в очередь
      const timeoutMs = (step.timeout_min || 20) * 60 * 1000;
      await this.queueManager.enqueue(proc.id, { timeoutMs });

      console.log(`Scheduler: step ${step.id} → process ${proc.id} enqueued`);
    } catch (err) {
      console.error(`Scheduler: failed to launch step ${step.id}:`, err.message);
      await planSteps.update(step.id, { status: 'failed', error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Scenarios — cron-triggered scenario execution
  // ═══════════════════════════════════════════════════════════

  async _runDueScenarios() {
    if (!this.scenarioRunner) return;
    try {
      const due = await scenariosDb.getDueScenarios();
      for (const scenario of due) {
        try {
          console.log(`Scheduler: cron trigger scenario "${scenario.name}" (${scenario.preset})`);
          await this.scenarioRunner.run(scenario, 'cron');
        } catch (err) {
          console.error(`Scheduler: scenario "${scenario.name}" cron trigger error:`, err.message);
        }
      }
    } catch (err) {
      console.error('Scheduler _runDueScenarios error:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Automation — per-product automated triggers
  // ═══════════════════════════════════════════════════════════

  /**
   * Проверить и запустить автоматизацию для всех продуктов с настройками.
   */
  async _runAutomation() {
    try {
      const prods = await products.getWithAutomation();
      for (const product of prods) {
        await this._runProductAutomation(product);
      }
    } catch (err) {
      console.error('Scheduler _runAutomation error:', err.message);
    }
  }

  /**
   * Автоматизация для одного продукта.
   */
  async _runProductAutomation(product) {
    const auto = product.automation || {};

    // ── RC Auto-Sync ──
    if (auto.rc_auto_sync?.enabled && product.rc_system_id) {
      await this._autoRcSync(product, auto.rc_auto_sync);
    }

    // ── GitLab Auto-Sync ──
    if (auto.gitlab_auto_sync?.enabled && product.deploy?.gitlab?.project_id) {
      await this._autoGitlabSync(product, auto.gitlab_auto_sync);
    }

  }

  /**
   * Авто-синхронизация RC-тикетов по расписанию.
   */
  async _autoRcSync(product, config) {
    try {
      const intervalMs = (config.interval_hours || 24) * 3600_000;
      const lastSync = product.last_rc_sync_at ? new Date(product.last_rc_sync_at).getTime() : 0;

      if (Date.now() - lastSync < intervalMs) return; // ещё не пора

      console.log(`Automation: RC sync for "${product.name}" (every ${config.interval_hours}h)`);
      const syncResult = await rcSync.syncTickets(product.id);
      console.log(`Automation: RC sync done — new: ${syncResult.new}, updated: ${syncResult.updated}`);

      // Обновить время последней синхронизации
      await products.update(product.id, { last_rc_sync_at: new Date().toISOString() });

      // Auto-import по правилам
      let importedCount = 0;
      if (config.auto_import?.enabled && config.auto_import.rules?.length > 0) {
        const importResult = await rcSync.autoImportByRules(product.id, config.auto_import.rules);
        importedCount = importResult.imported;
        if (importedCount > 0) {
          console.log(`Automation: auto-imported ${importedCount} RC tickets (rules: ${config.auto_import.rules.join(', ')})`);
        }
      }

      // Notify: RC sync done
      if (syncResult.new > 0 || importedCount > 0) {
        notify('rc_sync_done', {
          product: product.name, product_id: product.id,
          new_count: syncResult.new, updated_count: syncResult.updated,
          imported_count: importedCount,
        }, getNotifyOpts(product)).catch(() => {});
      }

    } catch (err) {
      console.error(`Automation: RC sync error for "${product.name}":`, err.message);
    }
  }

  /**
   * Авто-синхронизация GitLab issues по расписанию.
   */
  async _autoGitlabSync(product, config) {
    try {
      const intervalMs = (config.interval_hours || 0.5) * 3600_000;
      const lastSync = product.last_gitlab_sync_at ? new Date(product.last_gitlab_sync_at).getTime() : 0;

      if (Date.now() - lastSync < intervalMs) return; // ещё не пора

      console.log(`Automation: GitLab sync for "${product.name}" (every ${config.interval_hours || 0.5}h)`);
      const syncResult = await gitlabSync.syncIssues(product.id);
      console.log(`Automation: GitLab sync done — new: ${syncResult.new}, updated: ${syncResult.updated}`);

      // Обновить время последней синхронизации
      await products.update(product.id, { last_gitlab_sync_at: new Date().toISOString() });

      // Auto-import по label rules
      let importedCount = 0;
      if (config.auto_import?.enabled && config.auto_import.label_rules?.length > 0) {
        const importResult = await gitlabSync.autoImportByLabels(product.id, config.auto_import.label_rules);
        importedCount = importResult.imported;
        if (importedCount > 0) {
          console.log(`Automation: auto-imported ${importedCount} GitLab issues (labels: ${config.auto_import.label_rules.join(', ')})`);
        }
      }

      // Notify: GitLab sync done
      if (syncResult.new > 0 || importedCount > 0) {
        notify('gitlab_sync_done', {
          product: product.name, product_id: product.id,
          new_count: syncResult.new, updated_count: syncResult.updated,
          imported_count: importedCount,
        }, getNotifyOpts(product)).catch(() => {});
      }

    } catch (err) {
      console.error(`Automation: GitLab sync error for "${product.name}":`, err.message);
    }
  }

  /**
   * Callback при завершении процесса — обновить шаг и перепроверить план.
   */
  async onProcessComplete(processId, status) {
    try {
      const proc = await processes.getById(processId);
      if (!proc?.plan_step_id) return; // не связан с планом

      // Обновить шаг
      const stepStatus = (status === 'completed') ? 'completed' : 'failed';
      const update = { status: stepStatus };
      if (status === 'failed') {
        update.error = proc.error || 'Process failed';
      }
      await planSteps.update(proc.plan_step_id, update);

      // Перепроверить план (может разблокировать следующие шаги)
      await this._processActivePlans();
    } catch (err) {
      console.error('Scheduler onProcessComplete error:', err.message);
    }
  }

  async _cleanupOldLogs() {
    try {
      const { rowCount } = await pool.query(`
        DELETE FROM opii.kaizen_process_logs
        WHERE created_at < NOW() - INTERVAL '90 days'`);
      if (rowCount > 0) {
        console.log(`Scheduler cleanup: ${rowCount} old log(s) deleted (>90 days)`);
      }
    } catch (err) {
      console.error('Scheduler _cleanupOldLogs error:', err.message);
    }
  }
}
