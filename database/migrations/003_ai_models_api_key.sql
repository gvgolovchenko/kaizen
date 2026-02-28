-- 003: Add api_key to ai_models for cloud providers
ALTER TABLE opii.kaizen_ai_models ADD COLUMN IF NOT EXISTS api_key TEXT;
