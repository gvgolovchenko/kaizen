-- Migrate from dual status (status + dev_status) to single linear status
-- New statuses: draft → spec → developing → developed → failed → published

-- Step 1: Expand status column to hold new values
-- (varchar 20 is enough for all new statuses)

-- Step 2: Migrate existing data
-- draft + spec exists + dev_status=done → developed
UPDATE opii.kaizen_releases SET status = 'developed' WHERE status = 'draft' AND dev_status = 'done';
-- draft + spec exists + dev_status=failed → failed
UPDATE opii.kaizen_releases SET status = 'failed' WHERE status = 'draft' AND dev_status = 'failed';
-- draft + spec exists + dev_status=in_progress → developing
UPDATE opii.kaizen_releases SET status = 'developing' WHERE status = 'draft' AND dev_status = 'in_progress';
-- draft + spec exists + dev_status is null/none → spec
UPDATE opii.kaizen_releases SET status = 'spec' WHERE status = 'draft' AND spec IS NOT NULL AND (dev_status IS NULL OR dev_status = '' OR dev_status = 'none');
-- released → published
UPDATE opii.kaizen_releases SET status = 'published' WHERE status = 'released';
-- draft without spec stays draft

-- Step 3: dev_status column kept for backward compatibility but no longer used by new code
