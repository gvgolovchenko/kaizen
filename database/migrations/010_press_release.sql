-- 010: Add press_release JSONB column to releases
ALTER TABLE opii.kaizen_releases
  ADD COLUMN IF NOT EXISTS press_release JSONB DEFAULT NULL;
