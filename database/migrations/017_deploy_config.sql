-- 017: Per-product deploy configuration (GitLab CI/CD)
-- Adds deploy JSONB field to products for GitLab integration and deployment settings
ALTER TABLE opii.kaizen_products ADD COLUMN IF NOT EXISTS deploy JSONB DEFAULT '{}';
