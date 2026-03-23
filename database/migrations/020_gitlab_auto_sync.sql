-- 020: Add last_gitlab_sync_at to products for GitLab auto-sync scheduling
ALTER TABLE opii.kaizen_products
  ADD COLUMN IF NOT EXISTS last_gitlab_sync_at TIMESTAMPTZ;
