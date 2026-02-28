-- 002_ai_models.sql
-- Глобальный справочник моделей ИИ (не привязан к продуктам)

CREATE TABLE IF NOT EXISTS opii.kaizen_ai_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) DEFAULT 'ollama',
    deployment VARCHAR(20) DEFAULT 'local' CHECK (deployment IN ('local', 'cloud')),
    model_id VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    parameters_size VARCHAR(50),
    context_length INTEGER,
    status VARCHAR(20) DEFAULT 'unknown' CHECK (status IN ('loaded', 'unloaded', 'unknown')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_kaizen_ai_models_provider ON opii.kaizen_ai_models(provider);
CREATE INDEX IF NOT EXISTS idx_kaizen_ai_models_deployment ON opii.kaizen_ai_models(deployment);
CREATE INDEX IF NOT EXISTS idx_kaizen_ai_models_status ON opii.kaizen_ai_models(status);

-- Триггер updated_at (переиспользуем существующую функцию)
DROP TRIGGER IF EXISTS trg_kaizen_ai_models_updated ON opii.kaizen_ai_models;
CREATE TRIGGER trg_kaizen_ai_models_updated
    BEFORE UPDATE ON opii.kaizen_ai_models
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
