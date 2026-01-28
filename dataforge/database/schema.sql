-- DataForge Database Schema
-- SQLite database for leads, campaigns, templates, and automation

-- Leads table - stores all extracted contacts
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT,
    email TEXT,
    email_verified INTEGER DEFAULT 0,
    phone TEXT,
    phone_verified INTEGER DEFAULT 0,
    linkedin_url TEXT,
    linkedin_id TEXT,
    title TEXT,
    company TEXT,
    company_domain TEXT,
    company_size TEXT,
    industry TEXT,
    location TEXT,
    country TEXT,
    profile_picture TEXT,
    source TEXT,
    quality_score INTEGER DEFAULT 0,
    tags TEXT, -- JSON array
    custom_fields TEXT, -- JSON object
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Campaigns table - email/linkedin/whatsapp campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'email', 'linkedin', 'whatsapp'
    status TEXT DEFAULT 'draft', -- 'draft', 'active', 'paused', 'completed'
    template_id INTEGER,
    settings TEXT, -- JSON object with campaign settings
    total_leads INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    bounce_count INTEGER DEFAULT 0,
    scheduled_at DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES templates(id)
);

-- Templates table - message templates with personalization
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'email', 'linkedin', 'whatsapp'
    subject TEXT, -- for emails
    body TEXT NOT NULL,
    variables TEXT, -- JSON array of variable names
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Campaign leads - junction table
CREATE TABLE IF NOT EXISTS campaign_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    lead_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'opened', 'replied', 'bounced', 'failed'
    sent_at DATETIME,
    opened_at DATETIME,
    replied_at DATETIME,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
);

-- Email accounts - SMTP configuration
CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_user TEXT NOT NULL,
    smtp_pass TEXT NOT NULL,
    smtp_secure INTEGER DEFAULT 1,
    daily_limit INTEGER DEFAULT 100,
    sent_today INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- LinkedIn accounts - for automation
CREATE TABLE IF NOT EXISTS linkedin_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    cookies TEXT, -- stored session cookies
    daily_limit INTEGER DEFAULT 50,
    actions_today INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- WhatsApp sessions
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    session_data TEXT, -- stored session
    daily_limit INTEGER DEFAULT 100,
    sent_today INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Scraping jobs
CREATE TABLE IF NOT EXISTS scraping_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'linkedin_search', 'linkedin_profile', 'email_find', 'web_scrape'
    query TEXT,
    settings TEXT, -- JSON object
    status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    total_results INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    error_message TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Activity log
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    description TEXT,
    metadata TEXT, -- JSON object
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_linkedin ON leads(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_status ON campaign_leads(status);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_status ON scraping_jobs(status);

-- Insert default templates
INSERT OR IGNORE INTO templates (id, name, type, subject, body, variables) VALUES
(1, 'Professional Outreach', 'email', 'Quick question, {{first_name}}', 
'Hi {{first_name}},

I noticed you''re the {{title}} at {{company}} and wanted to reach out.

{{custom_message}}

Would you be open to a quick chat?

Best,
{{sender_name}}', '["first_name", "title", "company", "custom_message", "sender_name"]'),

(2, 'LinkedIn Connection', 'linkedin', NULL,
'Hi {{first_name}}, I came across your profile and was impressed by your work at {{company}}. Would love to connect!', 
'["first_name", "company"]'),

(3, 'WhatsApp Intro', 'whatsapp', NULL,
'Hi {{first_name}}! 👋 This is {{sender_name}} from {{sender_company}}. {{custom_message}}',
'["first_name", "sender_name", "sender_company", "custom_message"]');

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
('app_name', 'DataForge'),
('email_delay_min', '30'),
('email_delay_max', '60'),
('linkedin_delay_min', '45'),
('linkedin_delay_max', '90'),
('whatsapp_delay_min', '20'),
('whatsapp_delay_max', '45'),
('auto_verify_emails', 'true'),
('proxy_enabled', 'false'),
('proxy_url', '');
