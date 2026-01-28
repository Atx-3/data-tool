/**
 * DataForge API Server
 * Express.js backend with REST API and WebSocket support
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Import modules
const db = require('./database');
const emailFinder = require('./extractors/email-finder');
const emailSender = require('./outreach/email-sender');
const LinkedInScraper = require('./extractors/linkedin');
const WebScraper = require('./extractors/web-scraper');
const LinkedInAutomation = require('./outreach/linkedin-auto');
const WhatsAppAutomation = require('./outreach/whatsapp-auto');
const scheduler = require('./utils/scheduler');
const proxyManager = require('./utils/proxy-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const upload = multer({
    dest: path.join(__dirname, 'data', 'uploads'),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Instances
let linkedinScraper = null;
let webScraper = null;
let linkedinAuto = null;
let whatsappAuto = null;

// ==================== DASHBOARD ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== STATS ====================

app.get('/api/stats', (req, res) => {
    try {
        const stats = db.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/activity', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const activity = db.getActivityLog(limit);
        res.json(activity);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== LEADS ====================

app.get('/api/leads', (req, res) => {
    try {
        const options = {
            search: req.query.search,
            source: req.query.source,
            hasEmail: req.query.hasEmail === 'true',
            hasPhone: req.query.hasPhone === 'true',
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        };
        const leads = db.getLeads(options);
        const total = db.getLeadsCount();
        res.json({ leads, total });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leads', (req, res) => {
    try {
        const id = db.createLead(req.body);
        res.json({ id, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/leads/:id', (req, res) => {
    try {
        db.updateLead(req.params.id, req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/leads/:id', (req, res) => {
    try {
        db.deleteLead(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Import leads from Excel/CSV
app.post('/api/leads/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Map columns
        const columnMapping = req.body.mapping ? JSON.parse(req.body.mapping) : {};

        const leads = data.map(row => {
            const lead = {};
            const fieldMap = {
                'first_name': ['first_name', 'firstname', 'first name', 'fname'],
                'last_name': ['last_name', 'lastname', 'last name', 'lname', 'surname'],
                'full_name': ['full_name', 'fullname', 'name', 'full name'],
                'email': ['email', 'e-mail', 'email address'],
                'phone': ['phone', 'phone number', 'telephone', 'mobile', 'cell'],
                'linkedin_url': ['linkedin', 'linkedin_url', 'linkedin url', 'linkedin profile'],
                'title': ['title', 'job title', 'position', 'designation'],
                'company': ['company', 'company name', 'organization', 'employer'],
                'location': ['location', 'city', 'address'],
                'country': ['country']
            };

            Object.keys(fieldMap).forEach(field => {
                const aliases = fieldMap[field];
                for (const alias of aliases) {
                    const key = Object.keys(row).find(k => k.toLowerCase() === alias);
                    if (key && row[key]) {
                        lead[field] = row[key];
                        break;
                    }
                }
            });

            // Parse full name if no first/last name
            if (!lead.first_name && lead.full_name) {
                const parts = lead.full_name.split(' ');
                lead.first_name = parts[0];
                lead.last_name = parts.slice(1).join(' ');
            }

            return lead;
        }).filter(l => l.first_name || l.email || l.phone);

        const ids = db.bulkCreateLeads(leads);

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        db.logActivity('import', `Imported ${ids.length} leads from file`);
        res.json({ success: true, imported: ids.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export leads
app.get('/api/leads/export', (req, res) => {
    try {
        const leads = db.getLeads({ limit: 10000 });
        const worksheet = xlsx.utils.json_to_sheet(leads);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=leads.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== EMAIL DISCOVERY ====================

app.post('/api/email/find', async (req, res) => {
    try {
        const { firstName, lastName, domain, verify } = req.body;
        const result = await emailFinder.findEmail(firstName, lastName, domain, { verify });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/email/verify', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await emailFinder.verifySmtp(email);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== LINKEDIN SCRAPING ====================

// Initialize LinkedIn - opens browser and navigates to login page
app.post('/api/linkedin/init', async (req, res) => {
    try {
        linkedinScraper = new LinkedInScraper();
        await linkedinScraper.init();
        // Navigate to LinkedIn login page so user can log in
        await linkedinScraper.page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle' });
        res.json({ success: true, needsLogin: true, message: 'Please log in to LinkedIn in the browser window' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check if actually logged in
app.get('/api/linkedin/status', async (req, res) => {
    try {
        if (!linkedinScraper || !linkedinScraper.page) {
            return res.json({ connected: false, initialized: false });
        }
        // Check if logged in by looking at current URL or feed elements
        const url = linkedinScraper.page.url();
        const isLoggedIn = url.includes('/feed') || url.includes('/mynetwork') || url.includes('/messaging');

        if (!isLoggedIn) {
            // Try to detect if on a logged-in page by checking for nav elements
            try {
                const hasNav = await linkedinScraper.page.$('.global-nav');
                if (hasNav) {
                    linkedinScraper.isLoggedIn = true;
                    return res.json({ connected: true, initialized: true });
                }
            } catch (e) { }
        }

        linkedinScraper.isLoggedIn = isLoggedIn;
        res.json({ connected: isLoggedIn, initialized: true });
    } catch (error) {
        res.json({ connected: false, initialized: !!linkedinScraper, error: error.message });
    }
});

app.post('/api/linkedin/login', async (req, res) => {
    try {
        if (!linkedinScraper) {
            return res.status(400).json({ error: 'LinkedIn scraper not initialized' });
        }
        const { email, password } = req.body;
        const result = await linkedinScraper.login(email, password);
        if (result) {
            const cookies = await linkedinScraper.saveCookies();
            res.json({ success: true, cookies });
        } else {
            res.json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/linkedin/search', async (req, res) => {
    try {
        if (!linkedinScraper) {
            return res.status(400).json({ error: 'LinkedIn scraper not initialized' });
        }
        const { query, filters } = req.body;
        const profiles = await linkedinScraper.searchPeople(query, filters || {});

        // Save to database
        const ids = db.bulkCreateLeads(profiles);

        io.emit('linkedin:search:complete', { count: profiles.length });
        res.json({ profiles, saved: ids.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/linkedin/scrape-profile', async (req, res) => {
    try {
        if (!linkedinScraper) {
            return res.status(400).json({ error: 'LinkedIn scraper not initialized' });
        }
        const { url } = req.body;
        const profile = await linkedinScraper.scrapeProfile(url);

        if (profile) {
            const id = db.createLead(profile);
            res.json({ profile, id });
        } else {
            res.json({ profile: null });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== WEB SCRAPING ====================

app.post('/api/scrape/init', async (req, res) => {
    try {
        webScraper = new WebScraper();
        await webScraper.init();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scrape/company', async (req, res) => {
    try {
        if (!webScraper) {
            webScraper = new WebScraper();
            await webScraper.init();
        }
        const { company } = req.body;
        const info = await webScraper.findCompanyInfo(company);
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scrape/person', async (req, res) => {
    try {
        if (!webScraper) {
            webScraper = new WebScraper();
            await webScraper.init();
        }
        const { firstName, lastName, company } = req.body;
        const info = await webScraper.findPersonInfo(firstName, lastName, company);
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== CAMPAIGNS ====================

app.get('/api/campaigns', (req, res) => {
    try {
        const campaigns = db.getCampaigns(req.query);
        res.json(campaigns);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/campaigns', (req, res) => {
    try {
        const id = db.createCampaign(req.body);
        res.json({ id, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/campaigns/:id', (req, res) => {
    try {
        const campaign = db.getCampaign(req.params.id);
        const leads = db.getCampaignLeads(req.params.id);
        res.json({ campaign, leads });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/campaigns/:id/leads', (req, res) => {
    try {
        const { leadIds } = req.body;
        db.addLeadsToCampaign(req.params.id, leadIds);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/campaigns/:id/start', async (req, res) => {
    try {
        const campaign = db.getCampaign(req.params.id);

        if (campaign.type === 'email') {
            const result = await emailSender.sendCampaign(req.params.id);
            res.json(result);
        } else if (campaign.type === 'linkedin') {
            if (!linkedinAuto) {
                linkedinAuto = new LinkedInAutomation();
                await linkedinAuto.init();
            }
            const result = await linkedinAuto.runCampaign(req.params.id);
            res.json(result);
        } else if (campaign.type === 'whatsapp') {
            if (!whatsappAuto || !whatsappAuto.isReady) {
                return res.status(400).json({ error: 'WhatsApp not connected' });
            }
            const result = await whatsappAuto.runCampaign(req.params.id);
            res.json(result);
        } else {
            res.status(400).json({ error: 'Invalid campaign type' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/campaigns/:id/pause', (req, res) => {
    try {
        db.updateCampaign(req.params.id, { status: 'paused' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== TEMPLATES ====================

app.get('/api/templates', (req, res) => {
    try {
        const templates = db.getTemplates(req.query.type);
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/templates', (req, res) => {
    try {
        const id = db.createTemplate(req.body);
        res.json({ id, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/templates/:id', (req, res) => {
    try {
        db.updateTemplate(req.params.id, req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/templates/:id', (req, res) => {
    try {
        db.deleteTemplate(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== EMAIL ACCOUNTS ====================

app.get('/api/email-accounts', (req, res) => {
    try {
        const accounts = db.getEmailAccounts();
        // Hide passwords
        const safeAccounts = accounts.map(a => ({ ...a, smtp_pass: '****' }));
        res.json(safeAccounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/email-accounts', (req, res) => {
    try {
        const id = db.createEmailAccount(req.body);
        res.json({ id, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/email-accounts/:id/verify', async (req, res) => {
    try {
        const accounts = db.getEmailAccounts();
        const account = accounts.find(a => a.id === parseInt(req.params.id));
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        const result = await emailSender.verifyConnection(account);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== WHATSAPP ====================

app.post('/api/whatsapp/init', async (req, res) => {
    try {
        whatsappAuto = new WhatsAppAutomation();
        await whatsappAuto.init();
        const result = await whatsappAuto.connect();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/whatsapp/qr', async (req, res) => {
    try {
        if (!whatsappAuto) {
            return res.status(400).json({ error: 'WhatsApp not initialized' });
        }
        const qr = await whatsappAuto.getQRCode();
        res.json({ qr });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/whatsapp/status', (req, res) => {
    res.json({ connected: whatsappAuto?.isReady || false });
});

app.post('/api/whatsapp/send', async (req, res) => {
    try {
        if (!whatsappAuto || !whatsappAuto.isReady) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }
        const { phone, message } = req.body;
        const result = await whatsappAuto.sendMessage(phone, message);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SETTINGS ====================

app.get('/api/settings', (req, res) => {
    try {
        const settings = db.getAllSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/settings', (req, res) => {
    try {
        Object.keys(req.body).forEach(key => {
            db.setSetting(key, req.body[key]);
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SCHEDULING ====================

app.get('/api/scheduler/jobs', (req, res) => {
    res.json(scheduler.getScheduledJobs());
});

app.post('/api/scheduler/once', (req, res) => {
    try {
        const { campaignId, scheduledTime } = req.body;
        const result = scheduler.scheduleOnce(campaignId, scheduledTime);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scheduler/recurring', (req, res) => {
    try {
        const { campaignId, cronExpression, maxRuns, timezone } = req.body;
        const result = scheduler.scheduleRecurring(campaignId, cronExpression, { maxRuns, timezone });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/scheduler/daily', (req, res) => {
    try {
        const { campaignId, times, days } = req.body;
        const result = scheduler.scheduleDaily(campaignId, times, days);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/scheduler/:campaignId', (req, res) => {
    try {
        const result = scheduler.cancel(parseInt(req.params.campaignId));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PROXY ====================

app.get('/api/proxy/status', (req, res) => {
    res.json(proxyManager.getStats());
});

app.post('/api/proxy/config', (req, res) => {
    try {
        proxyManager.init(req.body);
        db.setSetting('proxy_config', JSON.stringify(req.body));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/proxy/add', (req, res) => {
    try {
        const { proxies } = req.body;
        const count = proxyManager.addProxies(proxies);
        db.setSetting('proxy_list', proxyManager.export());
        res.json({ success: true, added: count });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/proxy/import', upload.single('file'), (req, res) => {
    try {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const count = proxyManager.importFromText(content);
        fs.unlinkSync(req.file.path);
        db.setSetting('proxy_list', proxyManager.export());
        res.json({ success: true, imported: count });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/proxy/test', async (req, res) => {
    try {
        const results = await proxyManager.testAllProxies();
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/proxy/clear', (req, res) => {
    proxyManager.clear();
    db.setSetting('proxy_list', '');
    res.json({ success: true });
});

// ==================== TRACKING ====================

app.get('/api/track/open/:id', (req, res) => {
    emailSender.recordOpen(req.params.id);
    // Return 1x1 transparent pixel
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Content-Type', 'image/gif');
    res.send(pixel);
});

app.get('/api/track/click/:id', (req, res) => {
    emailSender.recordClick(req.params.id, req.query.url);
    res.redirect(req.query.url);
});

// ==================== WEBSOCKET ====================

io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Cleanup on exit
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (linkedinScraper) await linkedinScraper.close();
    if (webScraper) await webScraper.close();
    if (linkedinAuto) await linkedinAuto.close();
    if (whatsappAuto) await whatsappAuto.close();
    emailSender.close();
    db.close();
    process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ██████╗  █████╗ ████████╗ █████╗ ███████╗ ██████╗ ██████╗ ███████╗   ║
║     ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝   ║
║     ██║  ██║███████║   ██║   ███████║█████╗  ██║   ██║██████╔╝█████╗     ║
║     ██║  ██║██╔══██║   ██║   ██╔══██║██╔══╝  ██║   ██║██╔══██╗██╔══╝     ║
║     ██████╔╝██║  ██║   ██║   ██║  ██║██║     ╚██████╔╝██║  ██║███████╗   ║
║     ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝   ║
║                                                              ║
║     🚀 Server running at http://localhost:${PORT}              ║
║     📊 Dashboard: http://localhost:${PORT}                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
});

module.exports = { app, server, io };
