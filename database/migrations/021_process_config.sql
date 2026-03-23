-- Kaizen: Добавить JSONB config в processes для output_mode и прочих настроек

ALTER TABLE opii.kaizen_processes
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

COMMENT ON COLUMN opii.kaizen_processes.config IS 'Дополнительная конфигурация процесса (output_mode, retry_count и т.д.)';
