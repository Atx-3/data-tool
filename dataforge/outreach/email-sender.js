/**
 * Email Sender Module
 * Bulk email sending with SMTP, templates, personalization, and tracking
 */

const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

class EmailSender {
    constructor() {
        this.transporters = new Map();
        this.sendQueue = [];
        this.isProcessing = false;
    }

    /**
     * Create SMTP transporter for an account
     */
    createTransporter(account) {
        const transporter = nodemailer.createTransport({
            host: account.smtp_host,
            port: account.smtp_port,
            secure: account.smtp_secure === 1,
            auth: {
                user: account.smtp_user,
                pass: account.smtp_pass
            },
            pool: true,
            maxConnections: 3,
            maxMessages: 100
        });

        this.transporters.set(account.id, transporter);
        return transporter;
    }

    /**
     * Get or create transporter for account
     */
    getTransporter(account) {
        if (this.transporters.has(account.id)) {
            return this.transporters.get(account.id);
        }
        return this.createTransporter(account);
    }

    /**
     * Verify SMTP connection
     */
    async verifyConnection(account) {
        try {
            const transporter = this.getTransporter(account);
            await transporter.verify();
            console.log(`✅ SMTP connection verified for ${account.email}`);
            return { success: true };
        } catch (error) {
            console.error(`❌ SMTP verification failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Personalize template with lead data
     */
    personalizeTemplate(template, lead, customVars = {}) {
        let subject = template.subject || '';
        let body = template.body || '';

        const variables = {
            first_name: lead.first_name || '',
            last_name: lead.last_name || '',
            full_name: lead.full_name || `${lead.first_name} ${lead.last_name}`,
            email: lead.email || '',
            title: lead.title || '',
            company: lead.company || '',
            location: lead.location || '',
            ...customVars
        };

        // Replace variables in format {{variable_name}}
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
            subject = subject.replace(regex, variables[key]);
            body = body.replace(regex, variables[key]);
        });

        return { subject, body };
    }

    /**
     * Generate tracking pixel (for open tracking)
     */
    generateTrackingPixel(trackingId, baseUrl = 'http://localhost:3001') {
        return `<img src="${baseUrl}/api/track/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
    }

    /**
     * Wrap links for click tracking
     */
    wrapLinksForTracking(html, trackingId, baseUrl = 'http://localhost:3001') {
        const linkRegex = /<a\s+([^>]*href=["'])(https?:\/\/[^"']+)(["'][^>]*)>/gi;
        return html.replace(linkRegex, (match, prefix, url, suffix) => {
            const encodedUrl = encodeURIComponent(url);
            return `<a ${prefix}${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}${suffix}>`;
        });
    }

    /**
     * Send a single email
     */
    async sendEmail(options) {
        const {
            account,
            to,
            subject,
            html,
            text,
            replyTo,
            attachments = [],
            trackingId = null
        } = options;

        try {
            const transporter = this.getTransporter(account);

            let finalHtml = html;
            if (trackingId) {
                // Add tracking pixel
                finalHtml += this.generateTrackingPixel(trackingId);
                // Wrap links for click tracking
                finalHtml = this.wrapLinksForTracking(finalHtml, trackingId);
            }

            const mailOptions = {
                from: `${account.name} <${account.email}>`,
                to,
                subject,
                html: finalHtml,
                text: text || this.htmlToText(html),
                replyTo: replyTo || account.email,
                attachments,
                headers: {
                    'X-Mailer': 'DataForge',
                    'X-Campaign-ID': trackingId || uuidv4()
                }
            };

            const result = await transporter.sendMail(mailOptions);

            // Update account sent counter
            db.incrementEmailSent(account.id);

            console.log(`✅ Email sent to ${to}`);
            db.logActivity('email_sent', `Email sent to ${to}`, { subject, trackingId });

            return {
                success: true,
                messageId: result.messageId,
                trackingId
            };
        } catch (error) {
            console.error(`❌ Email send failed:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Convert HTML to plain text
     */
    htmlToText(html) {
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }

    /**
     * Send campaign emails
     */
    async sendCampaign(campaignId, options = {}) {
        const campaign = db.getCampaign(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        const template = db.getTemplate(campaign.template_id);
        if (!template) {
            throw new Error('Template not found');
        }

        const leads = db.getCampaignLeads(campaignId, 'pending');
        if (leads.length === 0) {
            console.log('No pending leads in campaign');
            return { sent: 0, failed: 0 };
        }

        // Get active email account
        const account = db.getActiveEmailAccount();
        if (!account) {
            throw new Error('No active email account available');
        }

        // Update campaign status
        db.updateCampaign(campaignId, { status: 'active', started_at: new Date().toISOString() });

        const settings = JSON.parse(campaign.settings || '{}');
        const delayMin = parseInt(db.getSetting('email_delay_min') || '30') * 1000;
        const delayMax = parseInt(db.getSetting('email_delay_max') || '60') * 1000;

        let sent = 0;
        let failed = 0;

        for (const lead of leads) {
            // Check if we've hit daily limit
            const currentAccount = db.getActiveEmailAccount();
            if (!currentAccount) {
                console.log('⚠️ Daily email limit reached');
                break;
            }

            // Personalize template
            const { subject, body } = this.personalizeTemplate(template, lead, settings.customVars || {});
            const trackingId = uuidv4();

            // Send email
            const result = await this.sendEmail({
                account: currentAccount,
                to: lead.email,
                subject,
                html: body.replace(/\n/g, '<br>'),
                trackingId
            });

            if (result.success) {
                db.updateCampaignLeadStatus(campaignId, lead.id, 'sent');
                sent++;
            } else {
                db.updateCampaignLeadStatus(campaignId, lead.id, 'failed', { error_message: result.error });
                failed++;
            }

            // Update campaign stats
            db.updateCampaign(campaignId, { sent_count: sent });

            // Random delay between emails
            const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
            await new Promise(r => setTimeout(r, delay));

            // Check if campaign was paused
            const updatedCampaign = db.getCampaign(campaignId);
            if (updatedCampaign.status === 'paused') {
                console.log('⏸️ Campaign paused');
                break;
            }
        }

        // Update campaign status
        const finalCampaign = db.getCampaign(campaignId);
        const pendingCount = db.getCampaignLeads(campaignId, 'pending').length;
        if (pendingCount === 0) {
            db.updateCampaign(campaignId, { status: 'completed', completed_at: new Date().toISOString() });
        }

        console.log(`📧 Campaign complete: ${sent} sent, ${failed} failed`);
        return { sent, failed };
    }

    /**
     * Quick send to list of emails
     */
    async quickSend(emails, subject, body, options = {}) {
        const account = db.getActiveEmailAccount();
        if (!account) {
            throw new Error('No active email account configured');
        }

        const results = [];

        for (const email of emails) {
            const result = await this.sendEmail({
                account,
                to: email,
                subject,
                html: body.replace(/\n/g, '<br>')
            });

            results.push({ email, ...result });

            // Delay
            await new Promise(r => setTimeout(r, options.delay || 5000));
        }

        return results;
    }

    /**
     * Record email open (called from tracking endpoint)
     */
    recordOpen(trackingId) {
        // Find campaign lead by tracking ID and update
        db.logActivity('email_open', `Email opened: ${trackingId}`);
        // Update campaign open count would require storing trackingId in campaign_leads
    }

    /**
     * Record link click
     */
    recordClick(trackingId, url) {
        db.logActivity('email_click', `Link clicked: ${trackingId}`, { url });
    }

    /**
     * Close all connections
     */
    close() {
        this.transporters.forEach(transporter => {
            transporter.close();
        });
        this.transporters.clear();
        console.log('✅ Email sender closed');
    }
}

module.exports = new EmailSender();
