-- Kaizen: Система непрерывного улучшения продуктов
-- Схема: opii

CREATE SCHEMA IF NOT EXISTS opii;

-- ============================================================
-- Products
-- ============================================================
CREATE TABLE IF NOT EXISTS opii.kaizen_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    repo_url VARCHAR(500),
    tech_stack VARCHAR(255),
    owner VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Issues
-- ============================================================
CREATE TABLE IF NOT EXISTS opii.kaizen_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'improvement',
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Releases
-- ============================================================
CREATE TABLE IF NOT EXISTS opii.kaizen_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'draft',
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Release_Issues (M:N)
-- ============================================================
CREATE TABLE IF NOT EXISTS opii.kaizen_release_issues (
    release_id UUID NOT NULL REFERENCES opii.kaizen_releases(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES opii.kaizen_issues(id) ON DELETE CASCADE,
    PRIMARY KEY (release_id, issue_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kaizen_issues_product ON opii.kaizen_issues(product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_issues_status ON opii.kaizen_issues(status);
CREATE INDEX IF NOT EXISTS idx_kaizen_releases_product ON opii.kaizen_releases(product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_releases_status ON opii.kaizen_releases(status);

-- ============================================================
-- Updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION opii.kaizen_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kaizen_products_updated ON opii.kaizen_products;
CREATE TRIGGER trg_kaizen_products_updated
    BEFORE UPDATE ON opii.kaizen_products
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();

DROP TRIGGER IF EXISTS trg_kaizen_issues_updated ON opii.kaizen_issues;
CREATE TRIGGER trg_kaizen_issues_updated
    BEFORE UPDATE ON opii.kaizen_issues
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();

DROP TRIGGER IF EXISTS trg_kaizen_releases_updated ON opii.kaizen_releases;
CREATE TRIGGER trg_kaizen_releases_updated
    BEFORE UPDATE ON opii.kaizen_releases
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
