-- 005: Добавить approved_count в процессы
ALTER TABLE opii.kaizen_processes
  ADD COLUMN IF NOT EXISTS approved_count integer DEFAULT 0;
