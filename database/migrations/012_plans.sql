-- 012_plans.sql — Plans & Plan Steps tables

CREATE TABLE IF NOT EXISTS opii.kaizen_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'scheduled', 'active', 'paused',
                         'completed', 'failed', 'cancelled')),
    on_failure VARCHAR(20) DEFAULT 'stop'
      CHECK (on_failure IN ('stop', 'skip')),
    is_template BOOLEAN DEFAULT false,
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opii.kaizen_plan_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES opii.kaizen_plans(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL DEFAULT 0,
    name VARCHAR(255),
    model_id UUID NOT NULL REFERENCES opii.kaizen_ai_models(id),
    process_type VARCHAR(50) NOT NULL DEFAULT 'improve',
    input_prompt TEXT,
    input_template_id VARCHAR(50),
    input_count INTEGER DEFAULT 5,
    release_id UUID REFERENCES opii.kaizen_releases(id),
    timeout_min INTEGER DEFAULT 20,
    depends_on UUID[],
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    process_id UUID REFERENCES opii.kaizen_processes(id),
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- FK process → plan_step (column already added in 011_queue.sql)
DO $$ BEGIN
  ALTER TABLE opii.kaizen_processes
    ADD CONSTRAINT fk_processes_plan_step
    FOREIGN KEY (plan_step_id) REFERENCES opii.kaizen_plan_steps(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_kaizen_plans_status ON opii.kaizen_plans(status);
CREATE INDEX IF NOT EXISTS idx_kaizen_plans_scheduled ON opii.kaizen_plans(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_kaizen_plan_steps_plan ON opii.kaizen_plan_steps(plan_id, step_order);

-- Триггеры updated_at
CREATE TRIGGER trg_kaizen_plans_updated BEFORE UPDATE ON opii.kaizen_plans
  FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
CREATE TRIGGER trg_kaizen_plan_steps_updated BEFORE UPDATE ON opii.kaizen_plan_steps
  FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
