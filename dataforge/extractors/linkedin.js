/**
 * LinkedIn Scraper Module
 * Extracts profiles, searches, and connection data from LinkedIn
 * Uses Playwright for browser automation with anti-detection
 */

const { chromium } = require('playwright');
const db = require('../database');

class LinkedInScraper {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isLoggedIn = false;
        this.delays = {
            min: 2000,
            max: 5000
        };
    }

    async delay(min = this.delays.min, max = this.delays.max) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async init() {
        // Use installed Edge browser instead of downloading Chromium
        this.browser = await chromium.launch({
            channel: 'msedge', // Uses installed Microsoft Edge
            headless: false, // Set to true for background operation
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--no-sandbox'
            ]
        });

        this.context = await this.browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });

        // Anti-detection scripts
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
        });

        this.page = await this.context.newPage();
        console.log('✅ LinkedIn Scraper initialized');
    }

    async loadCookies(cookiesJson) {
        try {
            const cookies = JSON.parse(cookiesJson);
            await this.context.addCookies(cookies);
            console.log('✅ Cookies loaded');
            return true;
        } catch (error) {
            console.error('❌ Failed to load cookies:', error.message);
            return false;
        }
    }

    async saveCookies() {
        const cookies = await this.context.cookies();
        return JSON.stringify(cookies);
    }

    async login(email, password) {
        try {
            await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle' });
            await this.delay(1000, 2000);

            await this.page.fill('#username', email);
            await this.delay(500, 1000);
            await this.page.fill('#password', password);
            await this.delay(500, 1000);

            await this.page.click('button[type="submit"]');
            await this.page.waitForNavigation({ waitUntil: 'networkidle' });
            await this.delay(2000, 3000);

            // Check if logged in
            const isLoggedIn = await this.page.url().includes('/feed') || await this.page.$('.global-nav');
            this.isLoggedIn = isLoggedIn;

            if (isLoggedIn) {
                console.log('✅ LinkedIn login successful');
                db.logActivity('linkedin_login', 'Successfully logged into LinkedIn');
            } else {
                console.log('⚠️ Login may have failed or requires verification');
            }

            return isLoggedIn;
        } catch (error) {
            console.error('❌ Login failed:', error.message);
            return false;
        }
    }

    async checkLoginStatus() {
        try {
            await this.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle' });
            await this.delay();
            this.isLoggedIn = await this.page.url().includes('/feed');
            return this.isLoggedIn;
        } catch (error) {
            return false;
        }
    }

    async searchPeople(query, filters = {}) {
        const results = [];

        try {
            // Build search URL
            let searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;

            if (filters.location) {
                searchUrl += `&geoUrn=${encodeURIComponent(filters.location)}`;
            }
            if (filters.industry) {
                searchUrl += `&industry=${encodeURIComponent(filters.industry)}`;
            }
            if (filters.company) {
                searchUrl += `&company=${encodeURIComponent(filters.company)}`;
            }

            await this.page.goto(searchUrl, { waitUntil: 'networkidle' });
            await this.delay(2000, 4000);

            // Scroll to load more results
            for (let i = 0; i < 3; i++) {
                await this.page.evaluate(() => window.scrollBy(0, 1000));
                await this.delay(1000, 2000);
            }

            // Extract profile cards
            const profiles = await this.page.$$eval('.reusable-search__result-container', (cards) => {
                return cards.map(card => {
                    const nameEl = card.querySelector('.entity-result__title-text a span[aria-hidden="true"]');
                    const linkEl = card.querySelector('.entity-result__title-text a');
                    const titleEl = card.querySelector('.entity-result__primary-subtitle');
                    const locationEl = card.querySelector('.entity-result__secondary-subtitle');
                    const imgEl = card.querySelector('.presence-entity__image');

                    return {
                        full_name: nameEl?.textContent?.trim() || '',
                        linkedin_url: linkEl?.href?.split('?')[0] || '',
                        title: titleEl?.textContent?.trim() || '',
                        location: locationEl?.textContent?.trim() || '',
                        profile_picture: imgEl?.src || ''
                    };
                }).filter(p => p.full_name && p.linkedin_url);
            });

            for (const profile of profiles) {
                // Parse name
                const nameParts = profile.full_name.split(' ');
                profile.first_name = nameParts[0] || '';
                profile.last_name = nameParts.slice(1).join(' ') || '';

                // Extract LinkedIn ID
                const urlParts = profile.linkedin_url.split('/in/');
                profile.linkedin_id = urlParts[1] || '';

                // Extract company from title
                const titleParts = profile.title.split(' at ');
                if (titleParts.length > 1) {
                    profile.title = titleParts[0];
                    profile.company = titleParts[1];
                }

                profile.source = 'linkedin_search';
                results.push(profile);
            }

            console.log(`✅ Found ${results.length} profiles`);
            db.logActivity('linkedin_search', `Search: "${query}" - Found ${results.length} profiles`);

            return results;
        } catch (error) {
            console.error('❌ Search failed:', error.message);
            return results;
        }
    }

    async scrapeProfile(profileUrl) {
        try {
            await this.page.goto(profileUrl, { waitUntil: 'networkidle' });
            await this.delay(2000, 4000);

            // Scroll to load content
            await this.page.evaluate(() => window.scrollBy(0, 500));
            await this.delay(1000, 2000);

            const profile = await this.page.evaluate(() => {
                const data = {};

                // Name
                const nameEl = document.querySelector('h1.text-heading-xlarge');
                data.full_name = nameEl?.textContent?.trim() || '';

                // Headline/Title
                const headlineEl = document.querySelector('.text-body-medium.break-words');
                data.title = headlineEl?.textContent?.trim() || '';

                // Location
                const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
                data.location = locationEl?.textContent?.trim() || '';

                // Profile picture
                const imgEl = document.querySelector('.pv-top-card-profile-picture__image');
                data.profile_picture = imgEl?.src || '';

                // Current company
                const experienceSection = document.querySelector('#experience');
                if (experienceSection) {
                    const companyEl = experienceSection.parentElement?.querySelector('.pv-entity__secondary-title');
                    data.company = companyEl?.textContent?.trim() || '';
                }

                // About section
                const aboutSection = document.querySelector('#about');
                if (aboutSection) {
                    const aboutEl = aboutSection.parentElement?.querySelector('.pv-shared-text-with-see-more span');
                    data.about = aboutEl?.textContent?.trim() || '';
                }

                // Contact info (if accessible)
                const contactLink = document.querySelector('a[href*="contact-info"]');
                data.hasContactInfo = !!contactLink;

                return data;
            });

            // Parse name
            const nameParts = profile.full_name.split(' ');
            profile.first_name = nameParts[0] || '';
            profile.last_name = nameParts.slice(1).join(' ') || '';

            // Extract LinkedIn ID from URL
            const urlParts = profileUrl.split('/in/');
            profile.linkedin_id = urlParts[1]?.replace('/', '') || '';
            profile.linkedin_url = profileUrl.split('?')[0];
            profile.source = 'linkedin_profile';

            // Try to get contact info
            if (profile.hasContactInfo) {
                const contactInfo = await this.scrapeContactInfo();
                Object.assign(profile, contactInfo);
            }

            console.log(`✅ Scraped profile: ${profile.full_name}`);
            return profile;
        } catch (error) {
            console.error('❌ Profile scrape failed:', error.message);
            return null;
        }
    }

    async scrapeContactInfo() {
        try {
            // Click contact info button
            await this.page.click('a[href*="contact-info"]');
            await this.delay(1000, 2000);

            const contactInfo = await this.page.evaluate(() => {
                const data = {};

                // Email
                const emailEl = document.querySelector('a[href^="mailto:"]');
                data.email = emailEl?.href?.replace('mailto:', '') || null;

                // Phone
                const phoneSection = document.querySelector('.ci-phone');
                if (phoneSection) {
                    const phoneEl = phoneSection.querySelector('span.t-14');
                    data.phone = phoneEl?.textContent?.trim() || null;
                }

                // Website
                const websiteEl = document.querySelector('a[href*="http"]:not([href*="linkedin"])');
                data.website = websiteEl?.href || null;

                return data;
            });

            // Close modal
            await this.page.keyboard.press('Escape');
            await this.delay(500, 1000);

            return contactInfo;
        } catch (error) {
            console.error('❌ Contact info scrape failed:', error.message);
            return {};
        }
    }

    async getConnections(limit = 100) {
        const connections = [];

        try {
            await this.page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', { waitUntil: 'networkidle' });
            await this.delay(2000, 3000);

            let loadedCount = 0;
            while (loadedCount < limit) {
                // Scroll to load more
                await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await this.delay(1500, 2500);

                const currentCount = await this.page.$$eval('.mn-connection-card', cards => cards.length);
                if (currentCount === loadedCount) break; // No more to load
                loadedCount = currentCount;
            }

            // Extract connections
            const data = await this.page.$$eval('.mn-connection-card', (cards) => {
                return cards.map(card => {
                    const nameEl = card.querySelector('.mn-connection-card__name');
                    const linkEl = card.querySelector('a.mn-connection-card__link');
                    const titleEl = card.querySelector('.mn-connection-card__occupation');

                    return {
                        full_name: nameEl?.textContent?.trim() || '',
                        linkedin_url: linkEl?.href?.split('?')[0] || '',
                        title: titleEl?.textContent?.trim() || ''
                    };
                }).filter(c => c.full_name);
            });

            connections.push(...data.slice(0, limit));
            console.log(`✅ Extracted ${connections.length} connections`);
            return connections;
        } catch (error) {
            console.error('❌ Connections extraction failed:', error.message);
            return connections;
        }
    }

    async sendConnectionRequest(profileUrl, message = '') {
        try {
            await this.page.goto(profileUrl, { waitUntil: 'networkidle' });
            await this.delay(2000, 3000);

            // Find connect button
            const connectBtn = await this.page.$('button:has-text("Connect")');
            if (!connectBtn) {
                console.log('⚠️ Connect button not found (might already be connected)');
                return false;
            }

            await connectBtn.click();
            await this.delay(1000, 2000);

            // Add note if message provided
            if (message) {
                const addNoteBtn = await this.page.$('button:has-text("Add a note")');
                if (addNoteBtn) {
                    await addNoteBtn.click();
                    await this.delay(500, 1000);
                    await this.page.fill('textarea[name="message"]', message);
                    await this.delay(500, 1000);
                }
            }

            // Send request
            const sendBtn = await this.page.$('button:has-text("Send")');
            if (sendBtn) {
                await sendBtn.click();
                await this.delay(1000, 2000);
                console.log('✅ Connection request sent');
                db.logActivity('linkedin_connect', `Connection request sent to ${profileUrl}`);
                return true;
            }

            return false;
        } catch (error) {
            console.error('❌ Connection request failed:', error.message);
            return false;
        }
    }

    async sendMessage(profileUrl, message) {
        try {
            await this.page.goto(profileUrl, { waitUntil: 'networkidle' });
            await this.delay(2000, 3000);

            // Find message button
            const messageBtn = await this.page.$('button:has-text("Message")');
            if (!messageBtn) {
                console.log('⚠️ Message button not found');
                return false;
            }

            await messageBtn.click();
            await this.delay(1500, 2500);

            // Type message
            const messageBox = await this.page.$('.msg-form__contenteditable');
            if (messageBox) {
                await messageBox.click();
                await this.page.keyboard.type(message, { delay: 50 });
                await this.delay(500, 1000);

                // Send
                const sendBtn = await this.page.$('button.msg-form__send-button');
                if (sendBtn) {
                    await sendBtn.click();
                    await this.delay(1000, 2000);
                    console.log('✅ Message sent');
                    db.logActivity('linkedin_message', `Message sent to ${profileUrl}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('❌ Message send failed:', error.message);
            return false;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('✅ LinkedIn Scraper closed');
        }
    }
}

module.exports = LinkedInScraper;
