const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class DatabaseManager {
    constructor() {
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.dbPath = path.join(dataDir, 'dataforge.db');
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initialize();
    }

    initialize() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        this.db.exec(schema);
        console.log('✅ Database initialized');
    }

    // ==================== LEADS ====================

    createLead(lead) {
        const stmt = this.db.prepare(`
            INSERT INTO leads (first_name, last_name, full_name, email, phone, linkedin_url, 
                linkedin_id, title, company, company_domain, company_size, industry, 
                location, country, profile_picture, source, tags, custom_fields)
            VALUES (@first_name, @last_name, @full_name, @email, @phone, @linkedin_url,
                @linkedin_id, @title, @company, @company_domain, @company_size, @industry,
                @location, @country, @profile_picture, @source, @tags, @custom_fields)
        `);
        const result = stmt.run({
            first_name: lead.first_name || null,
            last_name: lead.last_name || null,
            full_name: lead.full_name || null,
            email: lead.email || null,
            phone: lead.phone || null,
            linkedin_url: lead.linkedin_url || null,
            linkedin_id: lead.linkedin_id || null,
            title: lead.title || null,
            company: lead.company || null,
            company_domain: lead.company_domain || null,
            company_size: lead.company_size || null,
            industry: lead.industry || null,
            location: lead.location || null,
            country: lead.country || null,
            profile_picture: lead.profile_picture || null,
            source: lead.source || 'manual',
            tags: JSON.stringify(lead.tags || []),
            custom_fields: JSON.stringify(lead.custom_fields || {})
        });
        return result.lastInsertRowid;
    }

    bulkCreateLeads(leads) {
        const insert = this.db.prepare(`
            INSERT INTO leads (first_name, last_name, full_name, email, phone, linkedin_url, 
                linkedin_id, title, company, company_domain, company_size, industry, 
                location, country, profile_picture, source, tags, custom_fields)
            VALUES (@first_name, @last_name, @full_name, @email, @phone, @linkedin_url,
                @linkedin_id, @title, @company, @company_domain, @company_size, @industry,
                @location, @country, @profile_picture, @source, @tags, @custom_fields)
        `);

        const insertMany = this.db.transaction((leads) => {
            const ids = [];
            for (const lead of leads) {
                const result = insert.run({
                    first_name: lead.first_name || null,
                    last_name: lead.last_name || null,
                    full_name: lead.full_name || lead.first_name + ' ' + lead.last_name || null,
                    email: lead.email || null,
                    phone: lead.phone || null,
                    linkedin_url: lead.linkedin_url || null,
                    linkedin_id: lead.linkedin_id || null,
                    title: lead.title || null,
                    company: lead.company || null,
                    company_domain: lead.company_domain || null,
                    company_size: lead.company_size || null,
                    industry: lead.industry || null,
                    location: lead.location || null,
                    country: lead.country || null,
                    profile_picture: lead.profile_picture || null,
                    source: lead.source || 'import',
                    tags: JSON.stringify(lead.tags || []),
                    custom_fields: JSON.stringify(lead.custom_fields || {})
                });
                ids.push(result.lastInsertRowid);
            }
            return ids;
        });

        return insertMany(leads);
    }

    getLeads(options = {}) {
        let query = 'SELECT * FROM leads WHERE 1=1';
        const params = {};

        if (options.search) {
            query += ` AND (full_name LIKE @search OR email LIKE @search OR company LIKE @search)`;
            params.search = `%${options.search}%`;
        }

        if (options.source) {
            query += ` AND source = @source`;
            params.source = options.source;
        }

        if (options.hasEmail) {
            query += ` AND email IS NOT NULL AND email != ''`;
        }

        if (options.hasPhone) {
            query += ` AND phone IS NOT NULL AND phone != ''`;
        }

        query += ` ORDER BY created_at DESC`;

        if (options.limit) {
            query += ` LIMIT @limit`;
            params.limit = options.limit;
        }

        if (options.offset) {
            query += ` OFFSET @offset`;
            params.offset = options.offset;
        }

        return this.db.prepare(query).all(params);
    }

    getLead(id) {
        return this.db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    }

    updateLead(id, data) {
        const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        const stmt = this.db.prepare(`UPDATE leads SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`);
        return stmt.run({ ...data, id });
    }

    deleteLead(id) {
        return this.db.prepare('DELETE FROM leads WHERE id = ?').run(id);
    }

    getLeadsCount() {
        return this.db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    }

    // ==================== CAMPAIGNS ====================

    createCampaign(campaign) {
        const stmt = this.db.prepare(`
            INSERT INTO campaigns (name, type, template_id, settings, scheduled_at)
            VALUES (@name, @type, @template_id, @settings, @scheduled_at)
        `);
        const result = stmt.run({
            name: campaign.name,
            type: campaign.type,
            template_id: campaign.template_id || null,
            settings: JSON.stringify(campaign.settings || {}),
            scheduled_at: campaign.scheduled_at || null
        });
        return result.lastInsertRowid;
    }

    getCampaigns(options = {}) {
        let query = 'SELECT * FROM campaigns WHERE 1=1';
        const params = {};

        if (options.type) {
            query += ` AND type = @type`;
            params.type = options.type;
        }

        if (options.status) {
            query += ` AND status = @status`;
            params.status = options.status;
        }

        query += ` ORDER BY created_at DESC`;
        return this.db.prepare(query).all(params);
    }

    getCampaign(id) {
        return this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    }

    updateCampaign(id, data) {
        const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        const stmt = this.db.prepare(`UPDATE campaigns SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`);
        return stmt.run({ ...data, id });
    }

    addLeadsToCampaign(campaignId, leadIds) {
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO campaign_leads (campaign_id, lead_id) VALUES (@campaign_id, @lead_id)
        `);
        const insertMany = this.db.transaction((ids) => {
            for (const leadId of ids) {
                insert.run({ campaign_id: campaignId, lead_id: leadId });
            }
        });
        insertMany(leadIds);

        // Update total leads count
        const count = this.db.prepare('SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = ?').get(campaignId).count;
        this.updateCampaign(campaignId, { total_leads: count });
    }

    getCampaignLeads(campaignId, status = null) {
        let query = `
            SELECT l.*, cl.status as campaign_status, cl.sent_at, cl.opened_at, cl.replied_at
            FROM leads l
            JOIN campaign_leads cl ON l.id = cl.lead_id
            WHERE cl.campaign_id = ?
        `;
        if (status) {
            query += ` AND cl.status = ?`;
            return this.db.prepare(query).all(campaignId, status);
        }
        return this.db.prepare(query).all(campaignId);
    }

    updateCampaignLeadStatus(campaignId, leadId, status, extra = {}) {
        const updates = ['status = @status'];
        const params = { campaign_id: campaignId, lead_id: leadId, status };

        if (status === 'sent') updates.push('sent_at = CURRENT_TIMESTAMP');
        if (status === 'opened') updates.push('opened_at = CURRENT_TIMESTAMP');
        if (status === 'replied') updates.push('replied_at = CURRENT_TIMESTAMP');
        if (extra.error_message) {
            updates.push('error_message = @error_message');
            params.error_message = extra.error_message;
        }

        const stmt = this.db.prepare(`
            UPDATE campaign_leads SET ${updates.join(', ')} 
            WHERE campaign_id = @campaign_id AND lead_id = @lead_id
        `);
        return stmt.run(params);
    }

    // ==================== TEMPLATES ====================

    createTemplate(template) {
        const stmt = this.db.prepare(`
            INSERT INTO templates (name, type, subject, body, variables)
            VALUES (@name, @type, @subject, @body, @variables)
        `);
        const result = stmt.run({
            name: template.name,
            type: template.type,
            subject: template.subject || null,
            body: template.body,
            variables: JSON.stringify(template.variables || [])
        });
        return result.lastInsertRowid;
    }

    getTemplates(type = null) {
        if (type) {
            return this.db.prepare('SELECT * FROM templates WHERE type = ? ORDER BY created_at DESC').all(type);
        }
        return this.db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
    }

    getTemplate(id) {
        return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    }

    updateTemplate(id, data) {
        const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        const stmt = this.db.prepare(`UPDATE templates SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`);
        return stmt.run({ ...data, id });
    }

    deleteTemplate(id) {
        return this.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    }

    // ==================== EMAIL ACCOUNTS ====================

    createEmailAccount(account) {
        const stmt = this.db.prepare(`
            INSERT INTO email_accounts (name, email, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, daily_limit)
            VALUES (@name, @email, @smtp_host, @smtp_port, @smtp_user, @smtp_pass, @smtp_secure, @daily_limit)
        `);
        const result = stmt.run(account);
        return result.lastInsertRowid;
    }

    getEmailAccounts() {
        return this.db.prepare('SELECT * FROM email_accounts ORDER BY created_at DESC').all();
    }

    getActiveEmailAccount() {
        return this.db.prepare('SELECT * FROM email_accounts WHERE is_active = 1 AND sent_today < daily_limit ORDER BY sent_today ASC LIMIT 1').get();
    }

    incrementEmailSent(id) {
        return this.db.prepare('UPDATE email_accounts SET sent_today = sent_today + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    }

    resetDailyEmailCounts() {
        return this.db.prepare('UPDATE email_accounts SET sent_today = 0').run();
    }

    // ==================== LINKEDIN ACCOUNTS ====================

    createLinkedInAccount(account) {
        const stmt = this.db.prepare(`
            INSERT INTO linkedin_accounts (name, email, cookies, daily_limit)
            VALUES (@name, @email, @cookies, @daily_limit)
        `);
        const result = stmt.run(account);
        return result.lastInsertRowid;
    }

    getLinkedInAccounts() {
        return this.db.prepare('SELECT * FROM linkedin_accounts ORDER BY created_at DESC').all();
    }

    updateLinkedInCookies(id, cookies) {
        return this.db.prepare('UPDATE linkedin_accounts SET cookies = ? WHERE id = ?').run(cookies, id);
    }

    // ==================== WHATSAPP SESSIONS ====================

    createWhatsAppSession(session) {
        const stmt = this.db.prepare(`
            INSERT INTO whatsapp_sessions (name, phone, session_data, daily_limit)
            VALUES (@name, @phone, @session_data, @daily_limit)
        `);
        const result = stmt.run(session);
        return result.lastInsertRowid;
    }

    getWhatsAppSessions() {
        return this.db.prepare('SELECT * FROM whatsapp_sessions ORDER BY created_at DESC').all();
    }

    // ==================== SCRAPING JOBS ====================

    createScrapingJob(job) {
        const stmt = this.db.prepare(`
            INSERT INTO scraping_jobs (type, query, settings)
            VALUES (@type, @query, @settings)
        `);
        const result = stmt.run({
            type: job.type,
            query: job.query || null,
            settings: JSON.stringify(job.settings || {})
        });
        return result.lastInsertRowid;
    }

    getScrapingJobs(status = null) {
        if (status) {
            return this.db.prepare('SELECT * FROM scraping_jobs WHERE status = ? ORDER BY created_at DESC').all(status);
        }
        return this.db.prepare('SELECT * FROM scraping_jobs ORDER BY created_at DESC').all();
    }

    updateScrapingJob(id, data) {
        const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        const stmt = this.db.prepare(`UPDATE scraping_jobs SET ${fields} WHERE id = @id`);
        return stmt.run({ ...data, id });
    }

    // ==================== ACTIVITY LOG ====================

    logActivity(type, description, metadata = {}) {
        const stmt = this.db.prepare(`
            INSERT INTO activity_log (type, description, metadata)
            VALUES (@type, @description, @metadata)
        `);
        return stmt.run({
            type,
            description,
            metadata: JSON.stringify(metadata)
        });
    }

    getActivityLog(limit = 100) {
        return this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
    }

    // ==================== SETTINGS ====================

    getSetting(key) {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
    }

    setSetting(key, value) {
        const stmt = this.db.prepare(`
            INSERT INTO settings (key, value) VALUES (@key, @value)
            ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = CURRENT_TIMESTAMP
        `);
        return stmt.run({ key, value });
    }

    getAllSettings() {
        const rows = this.db.prepare('SELECT * FROM settings').all();
        const settings = {};
        for (const row of rows) {
            settings[row.key] = row.value;
        }
        return settings;
    }

    // ==================== STATS ====================

    getStats() {
        return {
            totalLeads: this.db.prepare('SELECT COUNT(*) as count FROM leads').get().count,
            leadsWithEmail: this.db.prepare("SELECT COUNT(*) as count FROM leads WHERE email IS NOT NULL AND email != ''").get().count,
            leadsWithPhone: this.db.prepare("SELECT COUNT(*) as count FROM leads WHERE phone IS NOT NULL AND phone != ''").get().count,
            totalCampaigns: this.db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count,
            activeCampaigns: this.db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'").get().count,
            emailsSent: this.db.prepare("SELECT SUM(sent_count) as total FROM campaigns WHERE type = 'email'").get().total || 0,
            linkedinSent: this.db.prepare("SELECT SUM(sent_count) as total FROM campaigns WHERE type = 'linkedin'").get().total || 0,
            whatsappSent: this.db.prepare("SELECT SUM(sent_count) as total FROM campaigns WHERE type = 'whatsapp'").get().total || 0
        };
    }

    close() {
        this.db.close();
    }
}

module.exports = new DatabaseManager();
