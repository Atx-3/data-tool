/**
 * DataForge Extension - Popup Script
 * Handles UI and communication with content script
 */

const API_BASE = 'http://localhost:3001/api';
let currentProfile = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    checkServerStatus();
    await getCurrentTab();
    loadStats();

    document.getElementById('save-btn').addEventListener('click', saveProfile);
    document.getElementById('refresh-btn').addEventListener('click', refreshData);
});

// Check if DataForge server is running
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE}/stats`, { method: 'GET' });
        if (response.ok) {
            document.getElementById('status').textContent = 'Connected';
            document.getElementById('status').className = 'status connected';
        } else {
            throw new Error('Server not available');
        }
    } catch (error) {
        document.getElementById('status').textContent = 'Offline';
        document.getElementById('status').className = 'status disconnected';
    }
}

// Get current tab and check if on LinkedIn
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('linkedin.com')) {
        document.getElementById('not-linkedin').style.display = 'block';
        document.getElementById('profile-section').style.display = 'none';
        return;
    }

    document.getElementById('not-linkedin').style.display = 'none';
    document.getElementById('profile-section').style.display = 'block';

    // Request profile data from content script
    chrome.tabs.sendMessage(tab.id, { action: 'getProfileData' }, (response) => {
        if (chrome.runtime.lastError) {
            console.log('Content script not ready');
            return;
        }
        if (response && response.profile) {
            displayProfile(response.profile);
        }
    });
}

// Display profile data in popup
function displayProfile(profile) {
    currentProfile = profile;

    setField('field-name', profile.full_name);
    setField('field-title', profile.title);
    setField('field-company', profile.company);
    setField('field-email', profile.email);
    setField('field-phone', profile.phone);
    setField('field-linkedin', profile.linkedin_url);
}

function setField(id, value) {
    const el = document.getElementById(id);
    if (value && value.trim()) {
        el.textContent = value;
        el.className = 'field-value';
    } else {
        el.textContent = 'Not found';
        el.className = 'field-value empty';
    }
}

// Save profile to DataForge
async function saveProfile() {
    if (!currentProfile) {
        showToast('No profile data to save', 'error');
        return;
    }

    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Saving...';

    try {
        const response = await fetch(`${API_BASE}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first_name: currentProfile.first_name || '',
                last_name: currentProfile.last_name || '',
                full_name: currentProfile.full_name || '',
                email: currentProfile.email || '',
                phone: currentProfile.phone || '',
                company: currentProfile.company || '',
                title: currentProfile.title || '',
                linkedin_url: currentProfile.linkedin_url || '',
                source: 'chrome_extension'
            })
        });

        if (response.ok) {
            showToast('Profile saved to DataForge!', 'success');
            incrementSavedCount();
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        showToast('Failed to save. Is DataForge running?', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<span>💾</span> Save to DataForge';
}

// Refresh data from page
async function refreshData() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'getProfileData' }, (response) => {
        if (response && response.profile) {
            displayProfile(response.profile);
            showToast('Data refreshed', 'success');
        }
    });
}

// Load stats from server
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        if (response.ok) {
            const stats = await response.json();
            document.getElementById('total-count').textContent = stats.totalLeads || 0;
        }
    } catch (error) { }

    // Load today's saved count from storage
    chrome.storage.local.get(['savedToday', 'savedDate'], (result) => {
        const today = new Date().toDateString();
        if (result.savedDate === today) {
            document.getElementById('saved-count').textContent = result.savedToday || 0;
        } else {
            document.getElementById('saved-count').textContent = '0';
        }
    });
}

function incrementSavedCount() {
    const today = new Date().toDateString();
    chrome.storage.local.get(['savedToday', 'savedDate'], (result) => {
        let count = 0;
        if (result.savedDate === today) {
            count = (result.savedToday || 0) + 1;
        } else {
            count = 1;
        }
        chrome.storage.local.set({ savedToday: count, savedDate: today });
        document.getElementById('saved-count').textContent = count;
    });

    // Refresh total count
    loadStats();
}

// Show toast notification
function showToast(message, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}
