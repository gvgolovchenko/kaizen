-- 006: Добавить поддержку спецификации релизов
-- spec TEXT в releases — текст AI-сгенерированной спецификации
-- release_id UUID в processes — привязка процесса prepare_spec к релизу

ALTER TABLE opii.kaizen_releases ADD COLUMN IF NOT EXISTS spec TEXT;

ALTER TABLE opii.kaizen_processes ADD COLUMN IF NOT EXISTS release_id UUID
    REFERENCES opii.kaizen_releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kaizen_processes_release
    ON opii.kaizen_processes(release_id) WHERE release_id IS NOT NULL;
