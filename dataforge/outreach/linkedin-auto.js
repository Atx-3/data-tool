/**
 * LinkedIn Automation Module
 * Automated connection requests, messaging, and profile engagement
 */

const LinkedInScraper = require('../extractors/linkedin');
const db = require('../database');

class LinkedInAutomation {
    constructor() {
        this.scraper = null;
        this.isRunning = false;
        this.delays = {
            connectionMin: 45000,
            connectionMax: 90000,
            messageMin: 30000,
            messageMax: 60000
        };
    }

    async init() {
        this.scraper = new LinkedInScraper();
        await this.scraper.init();
        console.log('✅ LinkedIn Automation initialized');
    }

    /**
     * Login with credentials
     */
    async login(email, password) {
        const result = await this.scraper.login(email, password);
        if (result) {
            // Save cookies
            const cookies = await this.scraper.saveCookies();
            // Could save to database for persistence
            return { success: true, cookies };
        }
        return { success: false };
    }

    /**
     * Login with saved cookies
     */
    async loginWithCookies(cookiesJson) {
        const loaded = await this.scraper.loadCookies(cookiesJson);
        if (loaded) {
            const isLoggedIn = await this.scraper.checkLoginStatus();
            return { success: isLoggedIn };
        }
        return { success: false };
    }

    /**
     * Load account from database
     */
    async loadAccount(accountId) {
        const account = db.getLinkedInAccounts().find(a => a.id === accountId);
        if (account && account.cookies) {
            return await this.loginWithCookies(account.cookies);
        }
        return { success: false, error: 'Account not found or no saved session' };
    }

    /**
     * Random delay between actions
     */
    async delay(min, max) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Personalize message template
     */
    personalizeMessage(template, lead) {
        let message = template;

        const variables = {
            first_name: lead.first_name || '',
            last_name: lead.last_name || '',
            full_name: lead.full_name || `${lead.first_name} ${lead.last_name}`,
            title: lead.title || '',
            company: lead.company || ''
        };

        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
            message = message.replace(regex, variables[key]);
        });

        return message;
    }

    /**
     * Send bulk connection requests
     */
    async sendConnectionRequests(leads, messageTemplate = '', options = {}) {
        if (this.isRunning) {
            throw new Error('Automation already running');
        }

        this.isRunning = true;
        const results = {
            sent: 0,
            failed: 0,
            skipped: 0,
            details: []
        };

        const dailyLimit = options.dailyLimit || 50;
        const account = db.getLinkedInAccounts().find(a => a.is_active);

        if (account && account.actions_today >= dailyLimit) {
            console.log('⚠️ Daily limit reached');
            this.isRunning = false;
            return results;
        }

        try {
            for (const lead of leads) {
                if (!lead.linkedin_url) {
                    results.skipped++;
                    results.details.push({ lead: lead.id, status: 'skipped', reason: 'no_linkedin_url' });
                    continue;
                }

                // Check daily limit
                if (results.sent >= dailyLimit) {
                    console.log('⚠️ Daily limit reached');
                    break;
                }

                const message = messageTemplate ? this.personalizeMessage(messageTemplate, lead) : '';

                const success = await this.scraper.sendConnectionRequest(lead.linkedin_url, message);

                if (success) {
                    results.sent++;
                    results.details.push({ lead: lead.id, status: 'sent' });
                    db.logActivity('linkedin_connection', `Connection request sent to ${lead.full_name}`);
                } else {
                    results.failed++;
                    results.details.push({ lead: lead.id, status: 'failed' });
                }

                // Random delay
                await this.delay(this.delays.connectionMin, this.delays.connectionMax);
            }
        } finally {
            this.isRunning = false;
        }

        console.log(`🔗 Connections: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`);
        return results;
    }

    /**
     * Send bulk messages to connections
     */
    async sendMessages(leads, messageTemplate, options = {}) {
        if (this.isRunning) {
            throw new Error('Automation already running');
        }

        this.isRunning = true;
        const results = {
            sent: 0,
            failed: 0,
            skipped: 0,
            details: []
        };

        const dailyLimit = options.dailyLimit || 100;

        try {
            for (const lead of leads) {
                if (!lead.linkedin_url) {
                    results.skipped++;
                    continue;
                }

                if (results.sent >= dailyLimit) {
                    console.log('⚠️ Daily limit reached');
                    break;
                }

                const message = this.personalizeMessage(messageTemplate, lead);
                const success = await this.scraper.sendMessage(lead.linkedin_url, message);

                if (success) {
                    results.sent++;
                    results.details.push({ lead: lead.id, status: 'sent' });
                    db.logActivity('linkedin_message', `Message sent to ${lead.full_name}`);
                } else {
                    results.failed++;
                    results.details.push({ lead: lead.id, status: 'failed' });
                }

                // Random delay
                await this.delay(this.delays.messageMin, this.delays.messageMax);
            }
        } finally {
            this.isRunning = false;
        }

        console.log(`💬 Messages: ${results.sent} sent, ${results.failed} failed`);
        return results;
    }

    /**
     * Run LinkedIn campaign
     */
    async runCampaign(campaignId) {
        const campaign = db.getCampaign(campaignId);
        if (!campaign || campaign.type !== 'linkedin') {
            throw new Error('Invalid LinkedIn campaign');
        }

        const template = db.getTemplate(campaign.template_id);
        if (!template) {
            throw new Error('Template not found');
        }

        const leads = db.getCampaignLeads(campaignId, 'pending');
        if (leads.length === 0) {
            console.log('No pending leads');
            return { sent: 0, failed: 0 };
        }

        // Update campaign status
        db.updateCampaign(campaignId, { status: 'active', started_at: new Date().toISOString() });

        const settings = JSON.parse(campaign.settings || '{}');
        const isConnectionRequest = settings.action === 'connect';

        let results;
        if (isConnectionRequest) {
            results = await this.sendConnectionRequests(leads, template.body);
        } else {
            results = await this.sendMessages(leads, template.body);
        }

        // Update campaign leads status
        for (const detail of results.details) {
            db.updateCampaignLeadStatus(campaignId, detail.lead, detail.status === 'sent' ? 'sent' : 'failed');
        }

        // Update campaign
        db.updateCampaign(campaignId, {
            sent_count: results.sent,
            status: 'completed',
            completed_at: new Date().toISOString()
        });

        return results;
    }

    /**
     * Profile viewing automation (for visibility)
     */
    async viewProfiles(profileUrls, options = {}) {
        const results = { viewed: 0, failed: 0 };

        for (const url of profileUrls) {
            try {
                await this.scraper.page.goto(url, { waitUntil: 'networkidle' });
                await this.delay(3000, 6000); // View for a few seconds
                results.viewed++;
                db.logActivity('linkedin_view', `Viewed profile: ${url}`);
            } catch (error) {
                results.failed++;
            }

            // Delay between views
            await this.delay(15000, 30000);
        }

        return results;
    }

    /**
     * Engage with posts (like)
     */
    async engageWithPosts(options = {}) {
        // Implementation for liking posts in feed
        // Would navigate to feed and like posts from target connections
        console.log('Post engagement not yet implemented');
    }

    async close() {
        if (this.scraper) {
            await this.scraper.close();
        }
        console.log('✅ LinkedIn Automation closed');
    }
}

module.exports = LinkedInAutomation;
