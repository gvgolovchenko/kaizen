-- 024: Add base_url to ai_models for custom API endpoints (e.g. Ollama OpenAI-compat)
ALTER TABLE opii.kaizen_ai_models ADD COLUMN IF NOT EXISTS base_url TEXT DEFAULT NULL;

COMMENT ON COLUMN opii.kaizen_ai_models.base_url IS 'Custom API base URL. For qwen-code/kilo-code with Ollama: http://localhost:11434/v1';
