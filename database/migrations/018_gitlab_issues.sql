-- GitLab Issues cache table (same pattern as kaizen_rc_tickets)

ALTER TABLE opii.kaizen_issues
    ADD COLUMN IF NOT EXISTS gitlab_issue_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_kaizen_issues_gitlab_issue
    ON opii.kaizen_issues(gitlab_issue_id);

CREATE TABLE IF NOT EXISTS opii.kaizen_gitlab_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    gitlab_issue_iid INTEGER NOT NULL,
    gitlab_issue_id INTEGER NOT NULL,
    gitlab_project_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    state TEXT,
    labels JSONB DEFAULT '[]',
    milestone TEXT,
    author TEXT,
    assignees JSONB DEFAULT '[]',
    gl_created_at TIMESTAMPTZ,
    gl_updated_at TIMESTAMPTZ,
    gl_closed_at TIMESTAMPTZ,
    web_url TEXT,
    issue_id UUID REFERENCES opii.kaizen_issues(id) ON DELETE SET NULL,
    sync_status TEXT DEFAULT 'new'
        CHECK (sync_status IN ('new', 'imported', 'ignored')),
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kaizen_gitlab_issues_unique
    ON opii.kaizen_gitlab_issues(gitlab_issue_iid, product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_gitlab_issues_product
    ON opii.kaizen_gitlab_issues(product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_gitlab_issues_sync
    ON opii.kaizen_gitlab_issues(sync_status);

CREATE TRIGGER trg_kaizen_gitlab_issues_updated
    BEFORE UPDATE ON opii.kaizen_gitlab_issues
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
