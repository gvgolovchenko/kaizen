import * as plans from './db/plans.js';
import * as planSteps from './db/plan-steps.js';
import * as processes from './db/processes.js';

/**
 * Scheduler — планировщик выполнения планов.
 * Тикает каждые 30 сек: активирует scheduled планы, запускает ready шаги.
 */
export class Scheduler {
  constructor(queueManager) {
    this.queueManager = queueManager;
    this.tickInterval = 30_000;
    this._timer = null;
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
        model_id: step.model_id,
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
