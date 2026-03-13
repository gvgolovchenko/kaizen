import * as plans from './db/plans.js';
import * as planSteps from './db/plan-steps.js';
import * as processes from './db/processes.js';
import * as products from './db/products.js';
import * as releases from './db/releases.js';
import * as rcSync from './rc-sync.js';
import { notify, getNotifyOpts } from './notifier.js';

/**
 * Scheduler — планировщик выполнения планов и автоматизации.
 * Тикает каждые 30 сек: активирует scheduled планы, запускает ready шаги,
 * выполняет автоматизацию продуктов (RC sync, auto-pipeline).
 */
export class Scheduler {
  constructor(queueManager) {
    this.queueManager = queueManager;
    this.tickInterval = 30_000;
    this._timer = null;
    this._automationCounter = 0; // проверяем автоматизацию каждые 2 минуты (4 тика)
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
    try {
      await this._activateScheduledPlans();
      await this._processActivePlans();

      // Автоматизация — раз в 2 минуты (каждые 4 тика по 30с)
      this._automationCounter++;
      if (this._automationCounter >= 4) {
        this._automationCounter = 0;
        await this._runAutomation();
      }
    } catch (err) {
      console.error('Scheduler tick error:', err.message);
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

        // Найти pending шаги, чьи depends_on все completed
        const readySteps = steps.filter(step => {
          if (step.status !== 'pending') return false;
          const deps = step.depends_on || [];
          return deps.every(depId => {
            const dep = steps.find(s => s.id === depId);
            return dep && (dep.status === 'completed' || (hasFailed && plan.on_failure === 'skip'));
          });
        });

        for (const step of readySteps) {
          await this._launchStep(plan, step);
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

    // ── Auto-Pipeline ──
    if (auto.auto_pipeline?.enabled) {
      await this._autoPipeline(product, auto.auto_pipeline);
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

      // Если триггер auto_pipeline = "on_sync" и были новые тикеты
      const autoPipeline = product.automation?.auto_pipeline;
      if (autoPipeline?.enabled && autoPipeline.trigger === 'on_sync' && syncResult.new > 0) {
        await this._triggerPipeline(product, autoPipeline);
      }
    } catch (err) {
      console.error(`Automation: RC sync error for "${product.name}":`, err.message);
    }
  }

  /**
   * Авто-запуск конвейера (threshold / schedule / on_sync).
   */
  async _autoPipeline(product, config) {
    try {
      // on_sync обрабатывается в _autoRcSync
      if (config.trigger === 'on_sync') return;

      if (config.trigger === 'schedule') {
        const intervalMs = (config.schedule_hours || 168) * 3600_000;
        const lastPipeline = product.last_pipeline_at ? new Date(product.last_pipeline_at).getTime() : 0;
        if (Date.now() - lastPipeline < intervalMs) return;
        await this._triggerPipeline(product, config);
      } else if (config.trigger === 'threshold') {
        const threshold = config.threshold_count || 5;
        const openIssues = parseInt(product.open_issues) || 0;
        if (openIssues < threshold) return;

        // Проверяем, нет ли уже запущенного pipeline
        const running = await processes.getAll({ product_id: product.id, status: 'running' });
        const queued = await processes.getAll({ product_id: product.id, status: 'queued' });
        if (running.length > 0 || queued.length > 0) return;

        await this._triggerPipeline(product, config);
      }
    } catch (err) {
      console.error(`Automation: pipeline trigger error for "${product.name}":`, err.message);
    }
  }

  /**
   * Фактический запуск конвейера для продукта.
   * Поддержка per-stage model_id и пресетов.
   */
  async _triggerPipeline(product, config) {
    const pipelineConfig = config.pipeline_config || {};
    const preset = config.preset || 'custom';

    // Глобальный model_id (fallback) — может быть на верхнем уровне или в improve
    const globalModelId = pipelineConfig.model_id
      || pipelineConfig.improve?.model_id;

    if (!globalModelId) {
      console.error(`Automation: no model_id configured for "${product.name}" pipeline`);
      return;
    }

    // Per-stage model resolution
    const improveModelId = pipelineConfig.improve?.model_id || globalModelId;
    const specModelId = pipelineConfig.spec?.model_id || globalModelId;

    // Resolve develop/press_release based on preset
    let developConfig = pipelineConfig.develop || {};
    let pressReleaseConfig = pipelineConfig.press_release || {};

    if (preset === 'full_cycle') {
      developConfig = { enabled: true, auto_publish: true, ...developConfig };
      pressReleaseConfig = { enabled: true, ...pressReleaseConfig };
    }

    // Auto-increment version
    const version = await this._autoVersion(product.id, pipelineConfig.version_strategy);

    console.log(`Automation: triggering pipeline for "${product.name}" v${version} (preset: ${preset})`);

    // Создаём improve-процесс (первый этап pipeline)
    const proc = await processes.create({
      product_id: product.id,
      model_id: improveModelId,
      type: 'improve',
      input_template_id: pipelineConfig.template_id || 'general',
      input_count: pipelineConfig.count || 5,
      input_prompt: JSON.stringify({
        _auto_pipeline: true,
        preset,
        version,
        release_name: `Авто-релиз ${version}`,
        auto_approve: pipelineConfig.auto_approve || 'high_and_critical',
        models: {
          improve: improveModelId,
          spec: specModelId,
          develop: developConfig.model_id || globalModelId,
          press_release: pressReleaseConfig.model_id || globalModelId,
        },
        develop: developConfig,
        press_release: pressReleaseConfig,
      }),
    });

    const timeoutMs = 20 * 60 * 1000;
    await this.queueManager.enqueue(proc.id, { timeoutMs });

    // Обновить время запуска pipeline
    await products.update(product.id, { last_pipeline_at: new Date().toISOString() });

    console.log(`Automation: pipeline process ${proc.id} enqueued for "${product.name}"`);
  }

  /**
   * Определить следующую версию для авто-релиза.
   */
  async _autoVersion(productId, strategy) {
    if (strategy === 'manual') return '0.0.0'; // placeholder

    // auto_increment — берём последнюю версию и бампим minor
    const allReleases = await releases.getByProduct(productId);
    if (!allReleases || allReleases.length === 0) return '1.0.0';

    // Сортируем по semver
    const versions = allReleases
      .map(r => r.version)
      .filter(v => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => {
        const [aMaj, aMin, aPat] = a.split('.').map(Number);
        const [bMaj, bMin, bPat] = b.split('.').map(Number);
        return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat);
      });

    if (versions.length === 0) return '1.0.0';

    const [maj, min, pat] = versions[0].split('.').map(Number);
    return `${maj}.${min + 1}.${pat}`;
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
}
