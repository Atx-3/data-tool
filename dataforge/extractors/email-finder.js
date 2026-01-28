/**
 * Email Finder Module
 * Discovers and verifies email addresses using pattern matching and SMTP verification
 */

const dns = require('dns').promises;
const net = require('net');
const db = require('../database');

class EmailFinder {
    constructor() {
        this.commonPatterns = [
            '{first}.{last}',
            '{first}{last}',
            '{f}{last}',
            '{first}_{last}',
            '{first}-{last}',
            '{last}.{first}',
            '{last}{first}',
            '{first}',
            '{last}',
            '{f}.{last}',
            '{first}.{l}',
            '{f}{l}'
        ];

        this.freeEmailDomains = [
            'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
            'aol.com', 'icloud.com', 'mail.com', 'protonmail.com'
        ];
    }

    /**
     * Generate possible email patterns for a person
     */
    generatePatterns(firstName, lastName, domain) {
        const first = firstName.toLowerCase().replace(/[^a-z]/g, '');
        const last = lastName.toLowerCase().replace(/[^a-z]/g, '');
        const f = first.charAt(0);
        const l = last.charAt(0);

        const emails = [];

        for (const pattern of this.commonPatterns) {
            const email = pattern
                .replace('{first}', first)
                .replace('{last}', last)
                .replace('{f}', f)
                .replace('{l}', l);

            emails.push(`${email}@${domain}`);
        }

        return emails;
    }

    /**
     * Validate email syntax
     */
    isValidSyntax(email) {
        const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return regex.test(email);
    }

    /**
     * Get MX records for a domain
     */
    async getMxRecords(domain) {
        try {
            const records = await dns.resolveMx(domain);
            return records.sort((a, b) => a.priority - b.priority);
        } catch (error) {
            return [];
        }
    }

    /**
     * Check if domain has valid MX records
     */
    async hasMxRecords(domain) {
        const records = await this.getMxRecords(domain);
        return records.length > 0;
    }

    /**
     * SMTP verification - checks if email exists on server
     */
    async verifySmtp(email, timeout = 10000) {
        return new Promise(async (resolve) => {
            const domain = email.split('@')[1];
            const mxRecords = await this.getMxRecords(domain);

            if (mxRecords.length === 0) {
                resolve({ valid: false, reason: 'no_mx_records' });
                return;
            }

            const mxHost = mxRecords[0].exchange;
            const socket = new net.Socket();
            let step = 0;
            let response = '';
            let result = { valid: false, reason: 'unknown' };

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                step = 1;
            });

            socket.on('data', (data) => {
                response += data.toString();

                if (step === 1 && response.includes('220')) {
                    socket.write('HELO verify.local\r\n');
                    step = 2;
                    response = '';
                } else if (step === 2 && response.includes('250')) {
                    socket.write(`MAIL FROM:<verify@verify.local>\r\n`);
                    step = 3;
                    response = '';
                } else if (step === 3 && response.includes('250')) {
                    socket.write(`RCPT TO:<${email}>\r\n`);
                    step = 4;
                    response = '';
                } else if (step === 4) {
                    if (response.includes('250')) {
                        result = { valid: true, reason: 'accepted' };
                    } else if (response.includes('550') || response.includes('551') || response.includes('552') || response.includes('553')) {
                        result = { valid: false, reason: 'rejected' };
                    } else if (response.includes('450') || response.includes('451') || response.includes('452')) {
                        result = { valid: null, reason: 'temporary_error' }; // Can't determine
                    }
                    socket.write('QUIT\r\n');
                    socket.destroy();
                }
            });

            socket.on('timeout', () => {
                result = { valid: null, reason: 'timeout' };
                socket.destroy();
            });

            socket.on('error', () => {
                result = { valid: null, reason: 'connection_error' };
                socket.destroy();
            });

            socket.on('close', () => {
                resolve(result);
            });

            try {
                socket.connect(25, mxHost);
            } catch (error) {
                resolve({ valid: null, reason: 'connection_failed' });
            }
        });
    }

    /**
     * Check if domain is a catch-all (accepts any email)
     */
    async isCatchAll(domain) {
        const randomEmail = `randomtest${Date.now()}@${domain}`;
        const result = await this.verifySmtp(randomEmail);
        return result.valid === true;
    }

    /**
     * Find and verify email for a person
     */
    async findEmail(firstName, lastName, domain, options = {}) {
        const result = {
            found: false,
            email: null,
            confidence: 0,
            allPatterns: [],
            verification: null
        };

        // Check if domain has MX records
        const hasMx = await this.hasMxRecords(domain);
        if (!hasMx) {
            result.verification = { valid: false, reason: 'no_mx_records' };
            return result;
        }

        // Check for catch-all
        const catchAll = await this.isCatchAll(domain);

        // Generate patterns
        const patterns = this.generatePatterns(firstName, lastName, domain);
        result.allPatterns = patterns;

        // If verify option is enabled, check each pattern
        if (options.verify) {
            for (const email of patterns) {
                const verification = await this.verifySmtp(email);

                if (verification.valid === true) {
                    result.found = true;
                    result.email = email;
                    result.confidence = catchAll ? 60 : 95;
                    result.verification = verification;
                    break;
                }

                // Add delay between checks to avoid rate limiting
                await new Promise(r => setTimeout(r, 1000));
            }
        } else {
            // Without verification, return most common pattern
            result.email = patterns[0]; // first.last@domain
            result.found = true;
            result.confidence = 50;
        }

        if (catchAll) {
            result.catchAll = true;
            result.confidence = Math.min(result.confidence, 60);
        }

        db.logActivity('email_find', `Email search for ${firstName} ${lastName} @ ${domain}`, { found: result.found, email: result.email });

        return result;
    }

    /**
     * Bulk email finding from leads
     */
    async findEmailsForLeads(leads, options = {}) {
        const results = [];

        for (const lead of leads) {
            if (!lead.first_name || !lead.last_name || !lead.company_domain) {
                results.push({ lead, found: false, reason: 'missing_data' });
                continue;
            }

            const result = await this.findEmail(
                lead.first_name,
                lead.last_name,
                lead.company_domain,
                options
            );

            results.push({ lead, ...result });

            // Update lead in database if email found
            if (result.found && result.email) {
                db.updateLead(lead.id, {
                    email: result.email,
                    email_verified: result.confidence >= 90 ? 1 : 0
                });
            }

            // Delay between requests
            await new Promise(r => setTimeout(r, options.delay || 2000));
        }

        return results;
    }

    /**
     * Extract domain from company name/website
     */
    guessDomain(company) {
        // Clean company name
        let domain = company.toLowerCase()
            .replace(/\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|company|limited)\s*$/i, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();

        return `${domain}.com`;
    }

    /**
     * Validate and clean email
     */
    cleanEmail(email) {
        if (!email) return null;
        email = email.toLowerCase().trim();
        return this.isValidSyntax(email) ? email : null;
    }
}

module.exports = new EmailFinder();
