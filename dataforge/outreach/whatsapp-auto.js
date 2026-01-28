/**
 * WhatsApp Automation Module
 * Bulk messaging via WhatsApp Web with session persistence
 */

const { chromium } = require('playwright');
const db = require('../database');
const fs = require('fs');
const path = require('path');

class WhatsAppAutomation {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isReady = false;
        this.sessionPath = path.join(__dirname, '..', 'data', 'whatsapp-session');
        this.delays = {
            messageMin: 20000,
            messageMax: 45000
        };
    }

    async delay(min = this.delays.messageMin, max = this.delays.messageMax) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async init(options = {}) {
        // Create session directory if not exists
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
        }

        // Use installed Edge browser instead of downloading Chromium
        this.browser = await chromium.launch({
            channel: 'msedge', // Uses installed Microsoft Edge
            headless: false, // WhatsApp Web requires visible browser
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.context = await this.browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            storageState: fs.existsSync(path.join(this.sessionPath, 'storage.json'))
                ? path.join(this.sessionPath, 'storage.json')
                : undefined
        });

        this.page = await this.context.newPage();
        console.log('✅ WhatsApp Automation initialized');
    }

    /**
     * Open WhatsApp Web and wait for QR scan
     */
    async connect() {
        try {
            await this.page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle' });

            // Check if already logged in
            const isLoggedIn = await this.checkLoginStatus();

            if (isLoggedIn) {
                console.log('✅ WhatsApp already connected');
                this.isReady = true;
                return { success: true, needsQR: false };
            }

            // Wait for QR code
            console.log('📱 Please scan the QR code with your phone...');

            // Wait for login (up to 60 seconds)
            try {
                await this.page.waitForSelector('[data-testid="chat-list"]', { timeout: 60000 });
                this.isReady = true;

                // Save session
                await this.saveSession();

                console.log('✅ WhatsApp connected successfully');
                return { success: true, needsQR: false };
            } catch {
                return { success: false, needsQR: true, message: 'QR scan timeout' };
            }
        } catch (error) {
            console.error('❌ WhatsApp connection failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if logged in
     */
    async checkLoginStatus() {
        try {
            await this.page.waitForSelector('[data-testid="chat-list"]', { timeout: 5000 });
            this.isReady = true;
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Save session for persistence
     */
    async saveSession() {
        try {
            const storageState = await this.context.storageState();
            fs.writeFileSync(
                path.join(this.sessionPath, 'storage.json'),
                JSON.stringify(storageState)
            );
            console.log('✅ Session saved');
        } catch (error) {
            console.error('❌ Failed to save session:', error.message);
        }
    }

    /**
     * Format phone number for WhatsApp
     */
    formatPhone(phone) {
        // Remove all non-digit characters except +
        let formatted = phone.replace(/[^\d+]/g, '');

        // Ensure starts with country code
        if (!formatted.startsWith('+')) {
            // Assume Indian number if 10 digits
            if (formatted.length === 10) {
                formatted = '+91' + formatted;
            } else if (formatted.length === 11 && formatted.startsWith('0')) {
                formatted = '+91' + formatted.slice(1);
            }
        }

        return formatted.replace('+', '');
    }

    /**
     * Send message to a phone number
     */
    async sendMessage(phone, message) {
        if (!this.isReady) {
            throw new Error('WhatsApp not connected. Please call connect() first.');
        }

        try {
            const formattedPhone = this.formatPhone(phone);

            // Navigate to chat
            const chatUrl = `https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
            await this.page.goto(chatUrl, { waitUntil: 'networkidle' });
            await this.delay(3000, 5000);

            // Check if number is valid
            const invalidNumber = await this.page.$('[data-testid="popup-contents"]');
            if (invalidNumber) {
                const popupText = await invalidNumber.textContent();
                if (popupText.includes('invalid') || popupText.includes('not on WhatsApp')) {
                    console.log(`⚠️ Invalid number: ${phone}`);
                    return { success: false, reason: 'invalid_number' };
                }
            }

            // Wait for message input to be ready
            await this.page.waitForSelector('[data-testid="conversation-compose-box-input"]', { timeout: 10000 });
            await this.delay(1000, 2000);

            // Click send button
            const sendButton = await this.page.$('[data-testid="send"]');
            if (sendButton) {
                await sendButton.click();
                await this.delay(2000, 3000);

                console.log(`✅ WhatsApp message sent to ${phone}`);
                db.logActivity('whatsapp_sent', `Message sent to ${phone}`);

                return { success: true };
            } else {
                // Try pressing Enter
                await this.page.keyboard.press('Enter');
                await this.delay(2000, 3000);

                console.log(`✅ WhatsApp message sent to ${phone}`);
                return { success: true };
            }
        } catch (error) {
            console.error(`❌ Failed to send to ${phone}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send message with media attachment
     */
    async sendMessageWithMedia(phone, message, mediaPath) {
        if (!this.isReady) {
            throw new Error('WhatsApp not connected');
        }

        try {
            const formattedPhone = this.formatPhone(phone);

            // Navigate to chat
            await this.page.goto(`https://web.whatsapp.com/send?phone=${formattedPhone}`, { waitUntil: 'networkidle' });
            await this.delay(3000, 5000);

            // Click attachment button
            const attachButton = await this.page.$('[data-testid="attach-menu-plus"]');
            if (attachButton) {
                await attachButton.click();
                await this.delay(500, 1000);

                // Upload file
                const fileInput = await this.page.$('input[type="file"]');
                if (fileInput && fs.existsSync(mediaPath)) {
                    await fileInput.setInputFiles(mediaPath);
                    await this.delay(2000, 3000);

                    // Add caption
                    if (message) {
                        const captionInput = await this.page.$('[data-testid="media-caption-input-container"] [contenteditable="true"]');
                        if (captionInput) {
                            await captionInput.click();
                            await this.page.keyboard.type(message, { delay: 30 });
                        }
                    }

                    // Send
                    const sendButton = await this.page.$('[data-testid="send"]');
                    if (sendButton) {
                        await sendButton.click();
                        await this.delay(3000, 5000);

                        console.log(`✅ Media message sent to ${phone}`);
                        return { success: true };
                    }
                }
            }

            return { success: false, error: 'Could not attach media' };
        } catch (error) {
            console.error(`❌ Failed to send media to ${phone}:`, error.message);
            return { success: false, error: error.message };
        }
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
            company: lead.company || '',
            phone: lead.phone || ''
        };

        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
            message = message.replace(regex, variables[key]);
        });

        return message;
    }

    /**
     * Send bulk messages
     */
    async sendBulkMessages(leads, messageTemplate, options = {}) {
        if (!this.isReady) {
            throw new Error('WhatsApp not connected');
        }

        const results = {
            sent: 0,
            failed: 0,
            invalid: 0,
            details: []
        };

        const dailyLimit = options.dailyLimit || 100;

        for (const lead of leads) {
            if (!lead.phone) {
                results.invalid++;
                results.details.push({ lead: lead.id, status: 'skipped', reason: 'no_phone' });
                continue;
            }

            if (results.sent >= dailyLimit) {
                console.log('⚠️ Daily limit reached');
                break;
            }

            const message = this.personalizeMessage(messageTemplate, lead);
            const result = await this.sendMessage(lead.phone, message);

            if (result.success) {
                results.sent++;
                results.details.push({ lead: lead.id, status: 'sent' });
            } else if (result.reason === 'invalid_number') {
                results.invalid++;
                results.details.push({ lead: lead.id, status: 'invalid' });
            } else {
                results.failed++;
                results.details.push({ lead: lead.id, status: 'failed', error: result.error });
            }

            // Random delay between messages
            await this.delay();
        }

        console.log(`💬 WhatsApp: ${results.sent} sent, ${results.failed} failed, ${results.invalid} invalid`);
        return results;
    }

    /**
     * Run WhatsApp campaign
     */
    async runCampaign(campaignId) {
        const campaign = db.getCampaign(campaignId);
        if (!campaign || campaign.type !== 'whatsapp') {
            throw new Error('Invalid WhatsApp campaign');
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

        const results = await this.sendBulkMessages(leads, template.body);

        // Update campaign leads status
        for (const detail of results.details) {
            const status = detail.status === 'sent' ? 'sent' : 'failed';
            db.updateCampaignLeadStatus(campaignId, detail.lead, status,
                detail.error ? { error_message: detail.error } : {});
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
     * Get QR code image for display
     */
    async getQRCode() {
        try {
            const qrCanvas = await this.page.$('canvas');
            if (qrCanvas) {
                const qrImage = await qrCanvas.screenshot();
                return qrImage.toString('base64');
            }
            return null;
        } catch {
            return null;
        }
    }

    async close() {
        // Save session before closing
        if (this.isReady) {
            await this.saveSession();
        }

        if (this.browser) {
            await this.browser.close();
        }
        console.log('✅ WhatsApp Automation closed');
    }
}

module.exports = WhatsAppAutomation;
