-- 015: Support run_tests process type (no AI model required)
-- Make model_id nullable in processes and plan_steps

ALTER TABLE opii.kaizen_processes ALTER COLUMN model_id DROP NOT NULL;
ALTER TABLE opii.kaizen_plan_steps ALTER COLUMN model_id DROP NOT NULL;
