-- =============================================================================
-- GTM Outbound System - Database Schema
-- =============================================================================
-- Foundation for the 6-phase GTM pipeline.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. OFFERS
CREATE TABLE IF NOT EXISTS offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    positioning JSONB,
    icp JSONB,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. CAMPAIGNS
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    signal_type TEXT
        CHECK (signal_type IN ('hiring', 'tech_stack', 'funding', 'growth', 'news', 'firmographic', 'custom')),
    signal_config JSONB,
    messaging_framework TEXT
        CHECK (messaging_framework IN ('pvp', 'use_case_driven')),
    copy_variants JSONB,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(offer_id, slug)
);

-- 3. COMPANIES
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    domain TEXT UNIQUE,
    website TEXT,
    industry TEXT,
    employee_count INTEGER,
    employee_count_range TEXT,
    revenue_range TEXT,
    founded_year INTEGER,
    location TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    tech_stack JSONB,
    signals_found JSONB,
    fit_score NUMERIC(5,2),
    fit_notes TEXT,
    disqualified BOOLEAN NOT NULL DEFAULT false,
    disqualification_reason TEXT,
    enrichment_data JSONB,
    source_api TEXT,
    source_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_fit_score ON companies(fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_source_campaign ON companies(source_campaign_id);

-- Flexible tagging for segmentation (e.g., msp-tier-1, referral-partner, archive)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_companies_tags ON companies USING GIN(tags);

-- 4. CONTACTS
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT,
    email TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    email_verification_date TIMESTAMPTZ,
    email_verification_source TEXT,
    phone TEXT,
    phone_type TEXT,
    linkedin_url TEXT,
    linkedin_connected BOOLEAN NOT NULL DEFAULT false,
    title TEXT,
    seniority TEXT
        CHECK (seniority IN ('c_suite', 'vp', 'director', 'manager', 'individual', NULL)),
    department TEXT,
    enrichment_data JSONB,
    source_api TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_linkedin ON contacts(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_seniority ON contacts(seniority);

-- 5. ENGAGEMENTS (active client relationships)
CREATE TABLE IF NOT EXISTS engagements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    service_scope TEXT NOT NULL,
    contract_type TEXT NOT NULL
        CHECK (contract_type IN ('retainer', 'project', 'hourly', 'equity')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed', 'churned')),
    value_amount NUMERIC(10,2),
    value_cadence TEXT
        CHECK (value_cadence IN ('one-time', 'monthly', 'annual', 'hourly')),
    value_notes TEXT,
    source TEXT,
    preferred_channel TEXT,
    started_at DATE NOT NULL,
    ended_at DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagements_company ON engagements(company_id);
CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status);

-- 6. CAMPAIGN_CONTACTS
CREATE TABLE IF NOT EXISTS campaign_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    sequence_step INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'replied', 'meeting_booked', 'proposal_sent', 'negotiating', 'closed_won', 'closed_lost', 'opted_out', 'bounced', 'completed')),
    deal_value NUMERIC(10,2),
    meeting_booked_at TIMESTAMPTZ,
    proposal_sent_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_contacted_at TIMESTAMPTZ,
    UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_contact ON campaign_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);

-- 7. MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_contact_id UUID NOT NULL REFERENCES campaign_contacts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL
        CHECK (channel IN ('email', 'linkedin_connection', 'linkedin_dm')),
    sequence_step INTEGER NOT NULL DEFAULT 1,
    copy_variant TEXT,
    subject TEXT,
    body TEXT NOT NULL,
    personalization_data JSONB,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'opened', 'replied', 'failed', 'bounced', 'cancelled')),
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    reply_content TEXT,
    reply_sentiment TEXT
        CHECK (reply_sentiment IN ('positive', 'negative', 'neutral', 'out_of_office', NULL)),
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    unipile_message_id TEXT,
    unipile_account_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_campaign_contact ON messages(campaign_contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_scheduled ON messages(scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_variant ON messages(copy_variant);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);

-- 8. ACCOUNT_ACTIVITY
CREATE TABLE IF NOT EXISTS account_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL
        CHECK (channel IN ('email', 'linkedin_connection', 'linkedin_dm')),
    action TEXT NOT NULL
        CHECK (action IN ('send', 'connect', 'message', 'reply')),
    account_id TEXT,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_activity_channel_date
    ON account_activity(channel, account_id, recorded_at);

-- 9. TOOL_USAGE
CREATE TABLE IF NOT EXISTS tool_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_name TEXT NOT NULL,
    operation TEXT,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    credits_used NUMERIC(10,4),
    cost_usd NUMERIC(10,4),
    request_params JSONB,
    response_summary TEXT,
    results_count INTEGER,
    duration_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT true,
    error TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_api ON tool_usage(api_name);
CREATE INDEX IF NOT EXISTS idx_tool_usage_campaign ON tool_usage(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tool_usage_date ON tool_usage(recorded_at);

-- 10. SIGNAL_ROUTING_AUDIT
CREATE TABLE IF NOT EXISTS signal_routing_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL,
    decision TEXT NOT NULL
        CHECK (decision IN ('accepted', 'skipped')),
    reason TEXT,
    candidate_domain TEXT,
    company_domain TEXT,
    source_api TEXT,
    result_url TEXT,
    result_title TEXT,
    payload JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_routing_audit_campaign
    ON signal_routing_audit(campaign_id);
CREATE INDEX IF NOT EXISTS idx_signal_routing_audit_signal
    ON signal_routing_audit(signal_type);
CREATE INDEX IF NOT EXISTS idx_signal_routing_audit_decision
    ON signal_routing_audit(decision);
CREATE INDEX IF NOT EXISTS idx_signal_routing_audit_recorded_at
    ON signal_routing_audit(recorded_at DESC);

-- 11. REVIEWS (competitive intelligence from G2, Capterra, TrustRadius)
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL
        CHECK (platform IN ('g2', 'capterra', 'trustradius')),
    review_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_slug TEXT,
    title TEXT,
    body TEXT,
    pros TEXT,
    cons TEXT,
    rating NUMERIC(3,1),
    rating_original NUMERIC(5,1),
    rating_scale TEXT,
    review_date DATE,
    review_url TEXT,
    reviewer_name TEXT,
    reviewer_job_title TEXT,
    reviewer_company TEXT,
    reviewer_company_size TEXT,
    reviewer_industry TEXT,
    verified BOOLEAN,
    incentivized BOOLEAN,
    recommend_score INTEGER,
    platform_data JSONB,
    raw_json JSONB NOT NULL,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(platform, review_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews(platform);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_name);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(review_date DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_scraped ON reviews(scraped_at DESC);

-- TRIGGERS
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_offers_updated_at ON offers;
CREATE TRIGGER update_offers_updated_at
    BEFORE UPDATE ON offers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_engagements_updated_at ON engagements;
CREATE TRIGGER update_engagements_updated_at
    BEFORE UPDATE ON engagements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- VIEWS
CREATE OR REPLACE VIEW campaign_overview AS
SELECT
    c.id AS campaign_id,
    c.slug AS campaign_slug,
    c.name AS campaign_name,
    c.status AS campaign_status,
    c.signal_type,
    o.slug AS offer_slug,
    o.name AS offer_name,
    COUNT(DISTINCT cc.id) AS total_contacts,
    COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'replied') AS replied_contacts,
    COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'meeting_booked') AS meetings_booked,
    COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'proposal_sent') AS proposals_sent,
    COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'negotiating') AS negotiating,
    COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'closed_won') AS closed_won,
    COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'closed_lost') AS closed_lost,
    COUNT(DISTINCT m.id) AS total_messages,
    COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'sent') AS sent_messages,
    COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'replied') AS replied_messages
FROM campaigns c
JOIN offers o ON c.offer_id = o.id
LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
LEFT JOIN messages m ON m.campaign_contact_id = cc.id
GROUP BY c.id, c.slug, c.name, c.status, c.signal_type, o.slug, o.name;

CREATE OR REPLACE VIEW daily_send_counts AS
SELECT
    account_id,
    channel,
    DATE(recorded_at AT TIME ZONE 'UTC') AS send_date,
    COUNT(*) AS send_count
FROM account_activity
WHERE action IN ('send', 'connect', 'message')
GROUP BY account_id, channel, DATE(recorded_at AT TIME ZONE 'UTC');

CREATE OR REPLACE VIEW campaign_costs AS
SELECT
    campaign_id,
    api_name,
    COUNT(*) AS api_calls,
    SUM(credits_used) AS total_credits,
    SUM(cost_usd) AS total_cost_usd,
    SUM(results_count) AS total_results
FROM tool_usage
WHERE campaign_id IS NOT NULL
GROUP BY campaign_id, api_name;
