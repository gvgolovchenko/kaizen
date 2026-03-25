-- 023_scenarios.sql — Сценарии (автономные рабочие процессы)
-- Сценарий = именованная конфигурация pipeline + расписание + история запусков

-- ── Таблица сценариев ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS opii.kaizen_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  product_id UUID REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
  preset VARCHAR(50) NOT NULL DEFAULT 'full_cycle',
    -- batch_develop: spec → develop → test → publish для списка релизов
    -- auto_release: form_release из open issues → spec → develop
    -- nightly_audit: improve → auto-approve → create issues
    -- full_cycle: improve → approve → release → spec → develop → publish → press_release
    -- analysis: improve → approve → release → spec
    -- custom: произвольная конфигурация
  config JSONB NOT NULL DEFAULT '{}',
    -- Общие: model_id, auto_approve, timeout_min
    -- batch_develop: { release_ids[], model_id, on_failure }
    -- auto_release: { model_id, max_issues, version_strategy, develop: {...} }
    -- nightly_audit: { model_id, template_id, count, auto_approve, products: [] (null = все) }
    -- full_cycle/analysis/custom: аналогично run_pipeline config
  cron VARCHAR(100),
    -- Cron-выражение (null = только ручной запуск)
    -- Примеры: '0 22 * * 1-5' (будни 22:00), '0 3 * * 0' (воскр 03:00)
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kaizen_scenarios_enabled
  ON opii.kaizen_scenarios (enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_kaizen_scenarios_next_run
  ON opii.kaizen_scenarios (next_run_at) WHERE enabled = true AND cron IS NOT NULL;

-- Триггер updated_at
CREATE OR REPLACE TRIGGER kaizen_scenarios_updated_at
  BEFORE UPDATE ON opii.kaizen_scenarios
  FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();

-- ── Таблица запусков сценариев ─────────────────────────────
CREATE TABLE IF NOT EXISTS opii.kaizen_scenario_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES opii.kaizen_scenarios(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
    -- running, completed, failed, cancelled
  "trigger" VARCHAR(20) NOT NULL DEFAULT 'manual',
    -- manual, cron
  config_snapshot JSONB,
    -- Снимок config на момент запуска
  result JSONB,
    -- Итоги: stages[], processes[], releases[], errors[]
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kaizen_scenario_runs_scenario
  ON opii.kaizen_scenario_runs (scenario_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_kaizen_scenario_runs_status
  ON opii.kaizen_scenario_runs (status) WHERE status = 'running';
