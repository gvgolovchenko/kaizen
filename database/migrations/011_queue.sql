-- 011_queue.sql — Queue support: status 'queued', priority, plan_step_id

-- Расширяем CHECK constraint для статуса
ALTER TABLE opii.kaizen_processes
  DROP CONSTRAINT IF EXISTS kaizen_processes_status_check;
ALTER TABLE opii.kaizen_processes
  ADD CONSTRAINT kaizen_processes_status_check
  CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed'));

-- Приоритет: 0 = normal, 1 = high, 2 = urgent
ALTER TABLE opii.kaizen_processes
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- Связь с шагом плана (FK добавится в 012_plans.sql)
ALTER TABLE opii.kaizen_processes
  ADD COLUMN IF NOT EXISTS plan_step_id UUID;

-- Индекс для выборки следующего из очереди
CREATE INDEX IF NOT EXISTS idx_kaizen_processes_queued
  ON opii.kaizen_processes(status, priority DESC, created_at ASC)
  WHERE status = 'queued';
