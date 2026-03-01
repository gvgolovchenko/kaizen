-- Kaizen: Процессы (асинхронные AI-операции с логированием)

-- ============================================================
-- Processes
-- ============================================================
CREATE TABLE IF NOT EXISTS opii.kaizen_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES opii.kaizen_ai_models(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'improve',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    input_prompt TEXT,
    input_template_id VARCHAR(50),
    input_count INTEGER DEFAULT 5,
    result JSONB,
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Process Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS opii.kaizen_process_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID NOT NULL REFERENCES opii.kaizen_processes(id) ON DELETE CASCADE,
    step VARCHAR(50) NOT NULL,
    message TEXT,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kaizen_processes_product ON opii.kaizen_processes(product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_processes_status ON opii.kaizen_processes(status);
CREATE INDEX IF NOT EXISTS idx_kaizen_process_logs_process ON opii.kaizen_process_logs(process_id);

-- ============================================================
-- Updated_at trigger (reuse existing function)
-- ============================================================
DROP TRIGGER IF EXISTS trg_kaizen_processes_updated ON opii.kaizen_processes;
CREATE TRIGGER trg_kaizen_processes_updated
    BEFORE UPDATE ON opii.kaizen_processes
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
