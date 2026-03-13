-- 016: Allow plans without product_id (for universal templates)
ALTER TABLE opii.kaizen_plans DROP CONSTRAINT kaizen_plans_product_id_fkey;
ALTER TABLE opii.kaizen_plans ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE opii.kaizen_plans ADD CONSTRAINT kaizen_plans_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES opii.kaizen_products(id) ON DELETE CASCADE;
