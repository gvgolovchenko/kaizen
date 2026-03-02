-- 008: Add approved_indices column to kaizen_processes
ALTER TABLE opii.kaizen_processes
  ADD COLUMN IF NOT EXISTS approved_indices jsonb DEFAULT '[]'::jsonb;
