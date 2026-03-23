-- Kaizen: Добавить labels JSONB в issues для хранения меток (из GitLab, RC и т.д.)

ALTER TABLE opii.kaizen_issues
  ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]';

COMMENT ON COLUMN opii.kaizen_issues.labels IS 'Метки задачи (массив строк), например ["bug", "priority::high", "backend"]';

CREATE INDEX IF NOT EXISTS idx_kaizen_issues_labels
  ON opii.kaizen_issues USING gin (labels);
