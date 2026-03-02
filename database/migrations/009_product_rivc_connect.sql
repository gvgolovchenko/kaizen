ALTER TABLE opii.kaizen_products
  ADD COLUMN IF NOT EXISTS rc_system_id INTEGER,
  ADD COLUMN IF NOT EXISTS rc_module_id INTEGER;
