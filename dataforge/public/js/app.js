/**
 * DataForge Dashboard Application
 */

const API_BASE = 'http://localhost:3001/api';
let socket;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    initNavigation();
    initTabs();
    initModals();
    initUpload();
    loadDashboard();
});

// WebSocket connection
function initSocket() {
    socket = io('http://localhost:3001');
    socket.on('connect', () => console.log('Connected to server'));
    socket.on('linkedin:search:complete', (data) => {
        showToast(`Found ${data.count} profiles`, 'success');
        loadLeads();
    });
}

// Navigation
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            showPage(page);
        });
    });
}

function showPage(pageName) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-page="${pageName}"]`)?.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`${pageName}-page`)?.classList.add('active');
    document.getElementById('page-title').textContent = pageName.charAt(0).toUpperCase() + pageName.slice(1);

    // Load page data
    if (pageName === 'dashboard') loadDashboard();
    else if (pageName === 'leads') loadLeads();
    else if (pageName === 'campaigns') loadCampaigns();
    else if (pageName === 'templates') loadTemplates();
    else if (pageName === 'settings') loadSettings();
    else if (pageName === 'scheduler') loadSchedulerPage();
    else if (pageName === 'proxy') loadProxyPage();
}

// Tabs
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tabId)?.classList.add('active');
        });
    });

    document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const type = btn.dataset.type;
            document.getElementById('company-scrape-form').style.display = type === 'company' ? 'block' : 'none';
            document.getElementById('person-scrape-form').style.display = type === 'person' ? 'block' : 'none';
        });
    });

    document.querySelectorAll('input[name="campaign-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.getElementById('linkedin-action-group').style.display = radio.value === 'linkedin' ? 'block' : 'none';
            loadTemplatesForSelect(radio.value);
        });
    });

    document.getElementById('template-type')?.addEventListener('change', (e) => {
        document.getElementById('template-subject-group').style.display = e.target.value === 'email' ? 'block' : 'none';
    });
}

// Modals
function initModals() {
    document.getElementById('modal-overlay')?.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        document.getElementById('modal-overlay').classList.remove('active');
    });
}

function showModal(id) {
    document.getElementById('modal-overlay').classList.add('active');
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    document.getElementById('modal-overlay').classList.remove('active');
}

function showImportModal() { showModal('import-modal'); }
function showAddLeadModal() { showModal('add-lead-modal'); }
function showCreateCampaignModal() { loadTemplatesForSelect('email'); showModal('create-campaign-modal'); }
function showCreateTemplateModal() { showModal('create-template-modal'); }
function showAddEmailAccountModal() { showModal('email-account-modal'); }

// File Upload
function initUpload() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('import-file');

    zone?.addEventListener('click', () => input.click());
    zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent-primary)'; });
    zone?.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone?.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = '';
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    input?.addEventListener('change', () => { if (input.files.length) handleFile(input.files[0]); });
}

let uploadedFile = null;
function handleFile(file) {
    uploadedFile = file;
    document.getElementById('import-filename').textContent = file.name;
    document.getElementById('import-preview').style.display = 'block';
    document.getElementById('import-btn').disabled = false;
}

// API Calls
async function api(endpoint, options = {}) {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options
        });
        return await res.json();
    } catch (error) {
        console.error('API Error:', error);
        showToast('API request failed', 'error');
        return null;
    }
}

// Dashboard
async function loadDashboard() {
    const stats = await api('/stats');
    if (stats) {
        document.getElementById('stat-total-leads').textContent = stats.totalLeads || 0;
        document.getElementById('stat-emails').textContent = stats.leadsWithEmail || 0;
        document.getElementById('stat-phones').textContent = stats.leadsWithPhone || 0;
        document.getElementById('stat-sent').textContent = (stats.emailsSent || 0) + (stats.linkedinSent || 0) + (stats.whatsappSent || 0);
    }

    const activity = await api('/activity?limit=10');
    const list = document.getElementById('activity-list');
    if (list && activity) {
        list.innerHTML = activity.map(a => `
            <div class="activity-item">
                <div class="activity-icon ${getActivityIcon(a.type)}"><i class="${getActivityIconClass(a.type)}"></i></div>
                <div class="activity-content">
                    <p>${a.description || a.type}</p>
                    <span class="activity-time">${formatTime(a.created_at)}</span>
                </div>
            </div>
        `).join('') || '<p style="color:var(--text-muted)">No recent activity</p>';
    }
    checkConnectionStatus();
}

function getActivityIcon(type) {
    if (type.includes('linkedin')) return 'linkedin';
    if (type.includes('email')) return 'email';
    if (type.includes('whatsapp')) return 'whatsapp';
    return 'scrape';
}

function getActivityIconClass(type) {
    if (type.includes('linkedin')) return 'fab fa-linkedin';
    if (type.includes('email')) return 'fas fa-envelope';
    if (type.includes('whatsapp')) return 'fab fa-whatsapp';
    return 'fas fa-search';
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

// Leads
async function loadLeads() {
    const params = new URLSearchParams();
    const source = document.getElementById('lead-source-filter')?.value;
    const hasEmail = document.getElementById('has-email-filter')?.checked;
    const hasPhone = document.getElementById('has-phone-filter')?.checked;
    if (source) params.set('source', source);
    if (hasEmail) params.set('hasEmail', 'true');
    if (hasPhone) params.set('hasPhone', 'true');

    const data = await api(`/leads?${params}`);
    const tbody = document.getElementById('leads-tbody');
    if (tbody && data?.leads) {
        tbody.innerHTML = data.leads.map(lead => `
            <tr>
                <td><input type="checkbox" data-id="${lead.id}"></td>
                <td>${lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`}</td>
                <td>${lead.email || '-'}</td>
                <td>${lead.phone || '-'}</td>
                <td>${lead.company || '-'}</td>
                <td>${lead.title || '-'}</td>
                <td><span class="badge-${lead.source?.includes('linkedin') ? 'linkedin' : 'email'}">${lead.source || '-'}</span></td>
                <td>
                    <button class="btn-icon" onclick="viewLead(${lead.id})"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" onclick="deleteLead(${lead.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No leads found</td></tr>';
        document.getElementById('leads-count').textContent = `${data.total} leads`;
    }
}

async function addLead() {
    const lead = {
        first_name: document.getElementById('add-first-name').value,
        last_name: document.getElementById('add-last-name').value,
        email: document.getElementById('add-email').value,
        phone: document.getElementById('add-phone').value,
        company: document.getElementById('add-company').value,
        title: document.getElementById('add-title').value,
        linkedin_url: document.getElementById('add-linkedin').value
    };
    const result = await api('/leads', { method: 'POST', body: JSON.stringify(lead) });
    if (result?.success) {
        showToast('Lead added successfully', 'success');
        closeModal('add-lead-modal');
        loadLeads();
    }
}

async function deleteLead(id) {
    if (confirm('Delete this lead?')) {
        await api(`/leads/${id}`, { method: 'DELETE' });
        loadLeads();
    }
}

async function importLeads() {
    if (!uploadedFile) return;
    const formData = new FormData();
    formData.append('file', uploadedFile);
    try {
        const res = await fetch(`${API_BASE}/leads/import`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(`Imported ${data.imported} leads`, 'success');
            closeModal('import-modal');
            loadLeads();
        }
    } catch (e) { showToast('Import failed', 'error'); }
}

function exportLeads() {
    window.open(`${API_BASE}/leads/export`, '_blank');
}

// LinkedIn
let linkedinStatusInterval = null;

async function initLinkedIn() {
    showToast('Opening LinkedIn login...', 'info');
    const result = await api('/linkedin/init', { method: 'POST' });

    if (result?.success) {
        showToast('Please log in to LinkedIn in the browser window', 'info');
        document.querySelector('#linkedin-login-status .status-badge').className = 'status-badge';
        document.querySelector('#linkedin-login-status .status-badge').textContent = 'Waiting for login...';

        // Start polling for login status
        if (linkedinStatusInterval) clearInterval(linkedinStatusInterval);
        linkedinStatusInterval = setInterval(checkLinkedInStatus, 3000);
    } else {
        showToast(result?.error || 'Failed to initialize LinkedIn', 'error');
    }
}

async function checkLinkedInStatus() {
    const status = await api('/linkedin/status');

    if (status?.connected) {
        clearInterval(linkedinStatusInterval);
        linkedinStatusInterval = null;

        document.getElementById('linkedin-search-section').style.display = 'block';
        document.getElementById('linkedin-login-section').style.display = 'none';
        document.querySelector('#linkedin-login-status .status-badge').className = 'status-badge connected';
        document.querySelector('#linkedin-login-status .status-badge').textContent = 'Connected';
        document.getElementById('linkedin-status').classList.add('connected');

        showToast('LinkedIn connected!', 'success');
    }
}

async function searchLinkedIn() {
    const query = document.getElementById('linkedin-query').value;
    if (!query) return showToast('Enter a search query', 'warning');
    showToast('Searching LinkedIn...', 'info');
    const result = await api('/linkedin/search', {
        method: 'POST',
        body: JSON.stringify({
            query, filters: {
                location: document.getElementById('linkedin-location').value,
                industry: document.getElementById('linkedin-industry').value
            }
        })
    });
    if (result?.profiles) {
        document.getElementById('linkedin-results').innerHTML = `<div class="result-card"><h4>Found ${result.profiles.length} profiles</h4><p>${result.saved} saved to database</p></div>`;
        showToast(`Found ${result.profiles.length} profiles`, 'success');
    }
}

// Email Finder
async function findEmail() {
    const firstName = document.getElementById('email-first-name').value;
    const lastName = document.getElementById('email-last-name').value;
    const domain = document.getElementById('email-domain').value;
    const verify = document.getElementById('verify-email').checked;

    if (!firstName || !lastName || !domain) return showToast('Fill all fields', 'warning');
    showToast('Finding email...', 'info');

    const result = await api('/email/find', { method: 'POST', body: JSON.stringify({ firstName, lastName, domain, verify }) });
    const container = document.getElementById('email-results');
    if (result) {
        container.innerHTML = result.found
            ? `<div class="result-card"><h4>${result.email}</h4><p>Confidence: ${result.confidence}%</p></div>`
            : `<div class="result-card"><h4>Email not found</h4><p>No verified email for this person</p></div>`;
    }
}

// Web Scraper
async function scrapeCompany() {
    const company = document.getElementById('scrape-company').value;
    if (!company) return showToast('Enter company name', 'warning');
    showToast('Searching...', 'info');
    const result = await api('/scrape/company', { method: 'POST', body: JSON.stringify({ company }) });
    document.getElementById('web-results').innerHTML = result
        ? `<div class="result-card"><h4>${result.name}</h4><p>Domain: ${result.domain || 'N/A'}</p><p>Emails: ${result.emails?.join(', ') || 'None'}</p><p>Phones: ${result.phones?.join(', ') || 'None'}</p></div>`
        : '';
}

async function scrapePerson() {
    const firstName = document.getElementById('scrape-first-name').value;
    const lastName = document.getElementById('scrape-last-name').value;
    const company = document.getElementById('scrape-person-company').value;
    if (!firstName || !lastName) return showToast('Enter name', 'warning');
    showToast('Searching...', 'info');
    const result = await api('/scrape/person', { method: 'POST', body: JSON.stringify({ firstName, lastName, company }) });
    document.getElementById('web-results').innerHTML = result
        ? `<div class="result-card"><h4>${result.name}</h4><p>Emails: ${result.emails?.join(', ') || 'None'}</p><p>LinkedIn: ${result.linkedin || 'Not found'}</p></div>`
        : '';
}

// Campaigns
async function loadCampaigns() {
    const data = await api('/campaigns');
    const grid = document.getElementById('campaigns-grid');
    if (grid && data) {
        grid.innerHTML = data.map(c => `
            <div class="campaign-card">
                <div class="campaign-card-header">
                    <div><h3>${c.name}</h3><span class="badge-${c.type}">${c.type}</span></div>
                    <span class="status-badge ${c.status === 'active' ? 'connected' : 'disconnected'}">${c.status}</span>
                </div>
                <div class="campaign-stats">
                    <div class="campaign-stat"><div class="value">${c.total_leads || 0}</div><div class="label">Leads</div></div>
                    <div class="campaign-stat"><div class="value">${c.sent_count || 0}</div><div class="label">Sent</div></div>
                    <div class="campaign-stat"><div class="value">${c.reply_count || 0}</div><div class="label">Replies</div></div>
                </div>
            </div>
        `).join('') || '<p style="color:var(--text-muted)">No campaigns yet</p>';
    }
}

async function createCampaign() {
    const campaign = {
        name: document.getElementById('campaign-name').value,
        type: document.querySelector('input[name="campaign-type"]:checked').value,
        template_id: document.getElementById('campaign-template').value || null,
        settings: { action: document.getElementById('linkedin-action')?.value }
    };
    if (!campaign.name) return showToast('Enter campaign name', 'warning');
    const result = await api('/campaigns', { method: 'POST', body: JSON.stringify(campaign) });
    if (result?.success) {
        showToast('Campaign created', 'success');
        closeModal('create-campaign-modal');
        loadCampaigns();
    }
}

// Templates
async function loadTemplates() {
    const data = await api('/templates');
    const grid = document.getElementById('templates-grid');
    if (grid && data) {
        grid.innerHTML = data.map(t => `
            <div class="template-card">
                <div class="template-card-header">
                    <h3>${t.name}</h3>
                    <span class="badge-${t.type}">${t.type}</span>
                </div>
                <p style="color:var(--text-secondary);margin-top:12px;font-size:0.9rem;">${t.body?.substring(0, 100)}...</p>
            </div>
        `).join('') || '<p style="color:var(--text-muted)">No templates yet</p>';
    }
}

async function loadTemplatesForSelect(type) {
    const data = await api(`/templates?type=${type}`);
    const select = document.getElementById('campaign-template');
    if (select && data) {
        select.innerHTML = '<option value="">Select template...</option>' + data.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
}

async function createTemplate() {
    const template = {
        name: document.getElementById('template-name').value,
        type: document.getElementById('template-type').value,
        subject: document.getElementById('template-subject').value,
        body: document.getElementById('template-body').value
    };
    if (!template.name || !template.body) return showToast('Fill required fields', 'warning');
    const result = await api('/templates', { method: 'POST', body: JSON.stringify(template) });
    if (result?.success) {
        showToast('Template created', 'success');
        closeModal('create-template-modal');
        loadTemplates();
    }
}

// Settings  
async function loadSettings() {
    const accounts = await api('/email-accounts');
    const list = document.getElementById('email-accounts-list');
    if (list && accounts) {
        list.innerHTML = accounts.map(a => `
            <div class="account-item">
                <div><strong>${a.name}</strong><br><small>${a.email}</small></div>
                <span class="status-badge ${a.is_active ? 'connected' : 'disconnected'}">${a.is_active ? 'Active' : 'Inactive'}</span>
            </div>
        `).join('') || '<p style="color:var(--text-muted)">No email accounts configured</p>';
    }

    const settings = await api('/settings');
    if (settings) {
        document.getElementById('email-delay-min').value = settings.email_delay_min || 30;
        document.getElementById('email-delay-max').value = settings.email_delay_max || 60;
        document.getElementById('linkedin-delay-min').value = settings.linkedin_delay_min || 45;
        document.getElementById('linkedin-delay-max').value = settings.linkedin_delay_max || 90;
        document.getElementById('whatsapp-delay-min').value = settings.whatsapp_delay_min || 20;
        document.getElementById('whatsapp-delay-max').value = settings.whatsapp_delay_max || 45;
    }
}

async function addEmailAccount() {
    const account = {
        name: document.getElementById('smtp-name').value,
        email: document.getElementById('smtp-email').value,
        smtp_host: document.getElementById('smtp-host').value,
        smtp_port: parseInt(document.getElementById('smtp-port').value),
        smtp_user: document.getElementById('smtp-user').value,
        smtp_pass: document.getElementById('smtp-pass').value,
        smtp_secure: document.getElementById('smtp-port').value === '465' ? 1 : 0,
        daily_limit: parseInt(document.getElementById('smtp-limit').value) || 100
    };
    const result = await api('/email-accounts', { method: 'POST', body: JSON.stringify(account) });
    if (result?.success) {
        showToast('Email account added', 'success');
        closeModal('email-account-modal');
        loadSettings();
        document.getElementById('email-status').classList.add('connected');
    }
}

async function saveSettings() {
    const settings = {
        email_delay_min: document.getElementById('email-delay-min').value,
        email_delay_max: document.getElementById('email-delay-max').value,
        linkedin_delay_min: document.getElementById('linkedin-delay-min').value,
        linkedin_delay_max: document.getElementById('linkedin-delay-max').value,
        whatsapp_delay_min: document.getElementById('whatsapp-delay-min').value,
        whatsapp_delay_max: document.getElementById('whatsapp-delay-max').value
    };
    await api('/settings', { method: 'PUT', body: JSON.stringify(settings) });
    showToast('Settings saved', 'success');
}

// WhatsApp
async function initWhatsApp() {
    showToast('Initializing WhatsApp...', 'info');
    const result = await api('/whatsapp/init', { method: 'POST' });
    if (result?.success) {
        document.getElementById('whatsapp-status').classList.add('connected');
        showToast('WhatsApp connected!', 'success');
    } else if (result?.needsQR) {
        showToast('Please scan QR code in browser window', 'info');
    }
}

async function checkConnectionStatus() {
    const wa = await api('/whatsapp/status');
    if (wa?.connected) document.getElementById('whatsapp-status').classList.add('connected');
}

// Toast notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    toast.innerHTML = `<i class="fas fa-${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Filter handlers
document.getElementById('lead-source-filter')?.addEventListener('change', loadLeads);
document.getElementById('has-email-filter')?.addEventListener('change', loadLeads);
document.getElementById('has-phone-filter')?.addEventListener('change', loadLeads);

// Schedule type toggle
document.querySelectorAll('input[name="schedule-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
        document.getElementById('schedule-once-options').style.display = radio.value === 'once' ? 'block' : 'none';
        document.getElementById('schedule-recurring-options').style.display = radio.value === 'recurring' ? 'block' : 'none';
        document.getElementById('schedule-daily-options').style.display = radio.value === 'daily' ? 'block' : 'none';
    });
});

// ==================== SCHEDULER ====================

async function loadSchedulerPage() {
    await loadScheduledJobs();
    await loadCampaignsForScheduler();
}

async function loadScheduledJobs() {
    const jobs = await api('/scheduler/jobs');
    const container = document.getElementById('scheduled-jobs-list');
    if (container && jobs) {
        if (jobs.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted)">No scheduled campaigns</p>';
        } else {
            container.innerHTML = jobs.map(job => `
                <div class="account-item">
                    <div>
                        <strong>${job.campaignName || 'Campaign #' + job.campaignId}</strong><br>
                        <small style="color:var(--text-muted)">
                            ${job.type === 'once' ? 'Scheduled: ' + new Date(job.scheduledTime).toLocaleString() : ''}
                            ${job.type === 'recurring' ? 'Cron: ' + job.cronExpression : ''}
                            ${job.type === 'daily' ? 'Daily at ' + job.times?.join(', ') : ''}
                        </small>
                    </div>
                    <button class="btn btn-sm btn-secondary" onclick="cancelSchedule(${job.campaignId})">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                </div>
            `).join('');
        }
    }
}

async function loadCampaignsForScheduler() {
    const campaigns = await api('/campaigns');
    const select = document.getElementById('schedule-campaign-select');
    if (select && campaigns) {
        select.innerHTML = '<option value="">Choose a campaign...</option>' +
            campaigns.map(c => `<option value="${c.id}">${c.name} (${c.type})</option>`).join('');
    }
}

async function scheduleCampaign() {
    const campaignId = parseInt(document.getElementById('schedule-campaign-select').value);
    const scheduleType = document.querySelector('input[name="schedule-type"]:checked').value;

    if (!campaignId) return showToast('Select a campaign', 'warning');

    let result;

    if (scheduleType === 'once') {
        const scheduledTime = document.getElementById('schedule-datetime').value;
        if (!scheduledTime) return showToast('Select date and time', 'warning');
        result = await api('/scheduler/once', {
            method: 'POST',
            body: JSON.stringify({ campaignId, scheduledTime: new Date(scheduledTime).toISOString() })
        });
    } else if (scheduleType === 'recurring') {
        const cronExpression = document.getElementById('schedule-cron').value;
        const maxRuns = document.getElementById('schedule-max-runs').value;
        if (!cronExpression) return showToast('Enter cron expression', 'warning');
        result = await api('/scheduler/recurring', {
            method: 'POST',
            body: JSON.stringify({ campaignId, cronExpression, maxRuns: maxRuns ? parseInt(maxRuns) : null })
        });
    } else if (scheduleType === 'daily') {
        const timesInput = document.getElementById('schedule-times').value;
        const times = timesInput.split(',').map(t => t.trim()).filter(t => t);
        const days = Array.from(document.querySelectorAll('input[name="schedule-day"]:checked')).map(c => parseInt(c.value));
        if (times.length === 0) return showToast('Enter at least one time', 'warning');
        result = await api('/scheduler/daily', {
            method: 'POST',
            body: JSON.stringify({ campaignId, times, days })
        });
    }

    if (result?.success) {
        showToast('Campaign scheduled!', 'success');
        loadScheduledJobs();
    } else if (result?.error) {
        showToast(result.error, 'error');
    }
}

async function cancelSchedule(campaignId) {
    if (confirm('Cancel this scheduled campaign?')) {
        const result = await api(`/scheduler/${campaignId}`, { method: 'DELETE' });
        if (result?.success) {
            showToast('Schedule cancelled', 'success');
            loadScheduledJobs();
        }
    }
}

// ==================== PROXY ====================

async function loadProxyPage() {
    await loadProxyStatus();
}

async function loadProxyStatus() {
    const status = await api('/proxy/status');
    if (status) {
        document.getElementById('proxy-enabled').checked = status.enabled;
        document.getElementById('proxy-strategy').value = status.strategy || 'round-robin';
        document.getElementById('proxy-count').textContent = status.totalProxies || 0;

        const tbody = document.getElementById('proxies-tbody');
        if (tbody) {
            if (status.proxies && status.proxies.length > 0) {
                tbody.innerHTML = status.proxies.map(p => `
                    <tr>
                        <td>${p.proxy.replace(/https?:\/\//, '').replace(/:.*@/, ':***@')}</td>
                        <td style="color:var(--success)">${p.successes || 0}</td>
                        <td style="color:${p.failures > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${p.failures || 0}</td>
                        <td>${p.avgResponseTime ? Math.round(p.avgResponseTime) + 'ms' : '-'}</td>
                        <td>${p.lastUsed ? new Date(p.lastUsed).toLocaleTimeString() : 'Never'}</td>
                        <td><span class="status-badge ${p.failures < 3 ? 'connected' : 'disconnected'}">${p.failures < 3 ? 'Active' : 'Failing'}</span></td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No proxies configured</td></tr>';
            }
        }
    }
}

async function saveProxyConfig() {
    const config = {
        enabled: document.getElementById('proxy-enabled').checked,
        rotationStrategy: document.getElementById('proxy-strategy').value,
        maxFailures: parseInt(document.getElementById('proxy-max-failures').value) || 3
    };

    const result = await api('/proxy/config', { method: 'POST', body: JSON.stringify(config) });
    if (result?.success) {
        showToast('Proxy config saved', 'success');
    }
}

async function addProxies() {
    const text = document.getElementById('proxy-list').value;
    if (!text.trim()) return showToast('Enter proxy list', 'warning');

    const proxies = text.split('\n').map(l => l.trim()).filter(l => l);
    const result = await api('/proxy/add', { method: 'POST', body: JSON.stringify({ proxies }) });

    if (result?.success) {
        showToast(`Added ${result.added} proxies`, 'success');
        document.getElementById('proxy-list').value = '';
        loadProxyStatus();
    }
}

async function testAllProxies() {
    showToast('Testing all proxies...', 'info');
    const results = await api('/proxy/test', { method: 'POST' });

    if (results) {
        const working = results.filter(r => r.working).length;
        const failed = results.length - working;
        showToast(`Tested ${results.length} proxies: ${working} working, ${failed} failed`, working > 0 ? 'success' : 'warning');
        loadProxyStatus();
    }
}

async function clearProxies() {
    if (confirm('Clear all proxies?')) {
        await api('/proxy/clear', { method: 'DELETE' });
        showToast('All proxies cleared', 'success');
        loadProxyStatus();
    }
}
