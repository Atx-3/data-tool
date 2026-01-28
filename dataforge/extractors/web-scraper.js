/**
 * Web Scraper Module
 * Multi-source data extraction from Google, Bing, and various websites
 */

const { chromium } = require('playwright');
const cheerio = require('cheerio');
const axios = require('axios');
const db = require('../database');

class WebScraper {
    constructor() {
        this.browser = null;
        this.context = null;
        this.delays = {
            min: 1500,
            max: 3000
        };
    }

    async delay(min = this.delays.min, max = this.delays.max) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async init() {
        this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.context = await this.browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        console.log('✅ Web Scraper initialized');
    }

    /**
     * Extract emails from text
     */
    extractEmails(text) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = text.match(emailRegex) || [];
        return [...new Set(matches)].filter(email => {
            // Filter out common fake/placeholder emails
            const lowered = email.toLowerCase();
            return !lowered.includes('example.com') &&
                !lowered.includes('test.com') &&
                !lowered.includes('email.com') &&
                !lowered.startsWith('your') &&
                !lowered.startsWith('name@');
        });
    }

    /**
     * Extract phone numbers from text
     */
    extractPhones(text) {
        const phonePatterns = [
            /\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
            /\+?[0-9]{2,3}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{3,4}/g,
            /\+91[-.\s]?[0-9]{10}/g
        ];

        let phones = [];
        for (const pattern of phonePatterns) {
            const matches = text.match(pattern) || [];
            phones.push(...matches);
        }

        // Clean and deduplicate
        return [...new Set(phones.map(p => p.replace(/[^\d+]/g, '')))];
    }

    /**
     * Extract social profile links
     */
    extractSocialLinks(html) {
        const $ = cheerio.load(html);
        const links = {
            linkedin: [],
            twitter: [],
            facebook: [],
            instagram: []
        };

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (href?.includes('linkedin.com/in/')) {
                links.linkedin.push(href);
            } else if (href?.includes('twitter.com/') || href?.includes('x.com/')) {
                links.twitter.push(href);
            } else if (href?.includes('facebook.com/')) {
                links.facebook.push(href);
            } else if (href?.includes('instagram.com/')) {
                links.instagram.push(href);
            }
        });

        // Deduplicate
        Object.keys(links).forEach(key => {
            links[key] = [...new Set(links[key])];
        });

        return links;
    }

    /**
     * Google search for contact information
     */
    async googleSearch(query, maxResults = 10) {
        const results = [];
        const page = await this.context.newPage();

        try {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}`;
            await page.goto(searchUrl, { waitUntil: 'networkidle' });
            await this.delay();

            // Extract search results
            const searchResults = await page.$$eval('#search .g', (elements) => {
                return elements.map(el => {
                    const titleEl = el.querySelector('h3');
                    const linkEl = el.querySelector('a');
                    const snippetEl = el.querySelector('.VwiC3b');

                    return {
                        title: titleEl?.textContent || '',
                        url: linkEl?.href || '',
                        snippet: snippetEl?.textContent || ''
                    };
                }).filter(r => r.url && !r.url.includes('google.com'));
            });

            results.push(...searchResults);
            console.log(`✅ Google search: found ${results.length} results`);
        } catch (error) {
            console.error('❌ Google search failed:', error.message);
        } finally {
            await page.close();
        }

        return results;
    }

    /**
     * Scrape contact page of a website
     */
    async scrapeContactPage(baseUrl) {
        const result = {
            emails: [],
            phones: [],
            socialLinks: {},
            addresses: []
        };

        const page = await this.context.newPage();

        try {
            // Try common contact page URLs
            const contactPaths = [
                '/contact', '/contact-us', '/about/contact',
                '/about', '/about-us', '/team', '/our-team',
                '/contact.html', '/contactus.html'
            ];

            // First, scrape the main page
            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await this.delay();

            let html = await page.content();
            let text = await page.evaluate(() => document.body.innerText);

            result.emails.push(...this.extractEmails(text));
            result.phones.push(...this.extractPhones(text));
            result.socialLinks = this.extractSocialLinks(html);

            // Try contact pages
            for (const path of contactPaths) {
                try {
                    const contactUrl = new URL(path, baseUrl).href;
                    await page.goto(contactUrl, { waitUntil: 'networkidle', timeout: 15000 });
                    await this.delay(500, 1000);

                    html = await page.content();
                    text = await page.evaluate(() => document.body.innerText);

                    result.emails.push(...this.extractEmails(text));
                    result.phones.push(...this.extractPhones(text));

                    const socialLinks = this.extractSocialLinks(html);
                    Object.keys(socialLinks).forEach(key => {
                        result.socialLinks[key] = [...new Set([...(result.socialLinks[key] || []), ...socialLinks[key]])];
                    });
                } catch {
                    // Page doesn't exist, continue
                }
            }

            // Deduplicate
            result.emails = [...new Set(result.emails)];
            result.phones = [...new Set(result.phones)];

            console.log(`✅ Scraped ${baseUrl}: ${result.emails.length} emails, ${result.phones.length} phones`);
        } catch (error) {
            console.error(`❌ Scrape failed for ${baseUrl}:`, error.message);
        } finally {
            await page.close();
        }

        return result;
    }

    /**
     * Find company information
     */
    async findCompanyInfo(companyName) {
        const info = {
            name: companyName,
            domain: null,
            description: null,
            industry: null,
            size: null,
            location: null,
            founded: null,
            emails: [],
            phones: [],
            socialLinks: {}
        };

        try {
            // Google search for company
            const searchResults = await this.googleSearch(`${companyName} company contact`, 5);

            if (searchResults.length > 0) {
                // Extract domain from first result
                const firstUrl = searchResults[0].url;
                const urlObj = new URL(firstUrl);
                info.domain = urlObj.hostname.replace('www.', '');

                // Scrape the website
                const contactData = await this.scrapeContactPage(firstUrl);
                Object.assign(info, contactData);
            }

            // Search for LinkedIn company page
            const linkedinResults = await this.googleSearch(`${companyName} site:linkedin.com/company`, 1);
            if (linkedinResults.length > 0) {
                info.socialLinks.linkedin_company = linkedinResults[0].url;
            }

            db.logActivity('company_search', `Company search: ${companyName}`, { found: !!info.domain });
        } catch (error) {
            console.error('❌ Company info search failed:', error.message);
        }

        return info;
    }

    /**
     * Find person's contact information across the web
     */
    async findPersonInfo(firstName, lastName, company = null) {
        const info = {
            name: `${firstName} ${lastName}`,
            emails: [],
            phones: [],
            linkedin: null,
            twitter: null,
            otherProfiles: []
        };

        try {
            let query = `"${firstName} ${lastName}"`;
            if (company) {
                query += ` "${company}"`;
            }

            // Search for person
            const searchResults = await this.googleSearch(`${query} email OR contact`, 10);

            for (const result of searchResults) {
                // Extract emails and phones from snippets
                info.emails.push(...this.extractEmails(result.snippet));
                info.phones.push(...this.extractPhones(result.snippet));

                // Check for social profiles
                if (result.url.includes('linkedin.com/in/')) {
                    info.linkedin = result.url;
                } else if (result.url.includes('twitter.com/') || result.url.includes('x.com/')) {
                    info.twitter = result.url;
                }
            }

            // Search specifically for LinkedIn
            if (!info.linkedin) {
                const linkedinQuery = `"${firstName} ${lastName}" ${company || ''} site:linkedin.com/in/`;
                const linkedinResults = await this.googleSearch(linkedinQuery, 1);
                if (linkedinResults.length > 0) {
                    info.linkedin = linkedinResults[0].url;
                }
            }

            // Deduplicate
            info.emails = [...new Set(info.emails)];
            info.phones = [...new Set(info.phones)];

            db.logActivity('person_search', `Person search: ${firstName} ${lastName}`, { found: info.emails.length > 0 || !!info.linkedin });
        } catch (error) {
            console.error('❌ Person info search failed:', error.message);
        }

        return info;
    }

    /**
     * Bulk scrape websites for contact data
     */
    async bulkScrapeWebsites(urls) {
        const results = [];

        for (const url of urls) {
            const data = await this.scrapeContactPage(url);
            results.push({ url, ...data });
            await this.delay(2000, 4000);
        }

        return results;
    }

    /**
     * HTTP request for simple pages (faster than browser)
     */
    async fetchPage(url) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            return null;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('✅ Web Scraper closed');
        }
    }
}

module.exports = WebScraper;
