-- Migration 014: Product automation settings
-- Adds JSONB column for per-product automation configuration

ALTER TABLE opii.kaizen_products
  ADD COLUMN IF NOT EXISTS automation JSONB DEFAULT '{}';

-- Track last automation run times
ALTER TABLE opii.kaizen_products
  ADD COLUMN IF NOT EXISTS last_rc_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_pipeline_at TIMESTAMPTZ;

COMMENT ON COLUMN opii.kaizen_products.automation IS 'Per-product automation settings (rc_auto_sync, auto_pipeline)';
COMMENT ON COLUMN opii.kaizen_products.last_rc_sync_at IS 'Last automated RC sync timestamp';
COMMENT ON COLUMN opii.kaizen_products.last_pipeline_at IS 'Last automated pipeline run timestamp';
