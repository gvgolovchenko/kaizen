-- Новые поля в kaizen_releases для отслеживания разработки
ALTER TABLE opii.kaizen_releases
    ADD COLUMN IF NOT EXISTS dev_branch  TEXT,
    ADD COLUMN IF NOT EXISTS dev_commit  TEXT,
    ADD COLUMN IF NOT EXISTS dev_status  VARCHAR(20) DEFAULT 'none'
        CHECK (dev_status IN ('none', 'in_progress', 'done', 'failed'));

-- Индекс для поиска релизов в разработке
CREATE INDEX IF NOT EXISTS idx_kaizen_releases_dev_status
    ON opii.kaizen_releases(dev_status)
    WHERE dev_status != 'none';
