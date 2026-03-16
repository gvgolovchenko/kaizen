-- 018: Add smoke_test JSONB to products for headless browser validation after develop_release
ALTER TABLE opii.kaizen_products ADD COLUMN IF NOT EXISTS smoke_test JSONB DEFAULT '{}';

COMMENT ON COLUMN opii.kaizen_products.smoke_test IS 'Smoke test config: {enabled, start_command, url, pages[], ready_timeout_ms, check_timeout_ms}';
