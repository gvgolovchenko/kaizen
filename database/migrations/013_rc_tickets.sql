-- 013: Интеграция с Rivc.Connect HelpDesk
-- Добавляет rc_ticket_id в kaizen_issues + таблица-кэш тикетов RC

-- Добавляем rc_ticket_id в существующую таблицу задач
ALTER TABLE opii.kaizen_issues
    ADD COLUMN IF NOT EXISTS rc_ticket_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_kaizen_issues_rc_ticket
    ON opii.kaizen_issues(rc_ticket_id);

-- Таблица-кэш тикетов RC
CREATE TABLE IF NOT EXISTS opii.kaizen_rc_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES opii.kaizen_products(id) ON DELETE CASCADE,
    rc_ticket_id INTEGER NOT NULL,
    rc_system_id INTEGER,
    rc_module_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    rc_status TEXT,
    rc_status_id SMALLINT,
    rc_priority TEXT,
    rc_priority_id SMALLINT,
    rc_type TEXT,
    rc_type_id SMALLINT,
    rc_author TEXT,
    rc_author_email TEXT,
    rc_created_at TIMESTAMPTZ,
    rc_updated_at TIMESTAMPTZ,
    rc_deadline DATE,
    issue_id UUID REFERENCES opii.kaizen_issues(id) ON DELETE SET NULL,
    sync_status TEXT DEFAULT 'new'
        CHECK (sync_status IN ('new', 'imported', 'ignored', 'closed_in_rc')),
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kaizen_rc_tickets_unique
    ON opii.kaizen_rc_tickets(rc_ticket_id, product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_rc_tickets_product
    ON opii.kaizen_rc_tickets(product_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_rc_tickets_sync
    ON opii.kaizen_rc_tickets(sync_status);

CREATE TRIGGER trg_kaizen_rc_tickets_updated
    BEFORE UPDATE ON opii.kaizen_rc_tickets
    FOR EACH ROW EXECUTE FUNCTION opii.kaizen_update_timestamp();
