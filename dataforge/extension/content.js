/**
 * DataForge Extension - Content Script
 * Runs on LinkedIn pages to extract profile data
 */

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getProfileData') {
        const profile = scrapeCurrentProfile();
        sendResponse({ profile });
    }
    return true;
});

// Main profile scraping function
function scrapeCurrentProfile() {
    const url = window.location.href;

    // Check if on a profile page
    if (!url.includes('/in/')) {
        return null;
    }

    const profile = {
        linkedin_url: url.split('?')[0],
        full_name: '',
        first_name: '',
        last_name: '',
        title: '',
        company: '',
        location: '',
        email: '',
        phone: '',
        about: ''
    };

    // Get name
    const nameEl = document.querySelector('h1.text-heading-xlarge') ||
        document.querySelector('.pv-text-details__left-panel h1') ||
        document.querySelector('.text-heading-xlarge');
    if (nameEl) {
        profile.full_name = nameEl.textContent.trim();
        const parts = profile.full_name.split(' ');
        profile.first_name = parts[0] || '';
        profile.last_name = parts.slice(1).join(' ') || '';
    }

    // Get headline/title
    const headlineEl = document.querySelector('.text-body-medium.break-words') ||
        document.querySelector('.pv-text-details__left-panel .text-body-medium');
    if (headlineEl) {
        const headline = headlineEl.textContent.trim();
        // Try to extract company from headline (format: "Title at Company")
        const atIndex = headline.toLowerCase().indexOf(' at ');
        if (atIndex > -1) {
            profile.title = headline.substring(0, atIndex).trim();
            profile.company = headline.substring(atIndex + 4).trim();
        } else {
            profile.title = headline;
        }
    }

    // Get location
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
    if (locationEl) {
        profile.location = locationEl.textContent.trim();
    }

    // Try to get company from experience section
    if (!profile.company) {
        const experienceCompany = document.querySelector('#experience ~ .pvs-list__container .hoverable-link-text span');
        if (experienceCompany) {
            profile.company = experienceCompany.textContent.trim();
        }
    }

    // Get about section
    const aboutSection = document.querySelector('#about');
    if (aboutSection) {
        const aboutText = aboutSection.closest('section')?.querySelector('.pv-shared-text-with-see-more span');
        if (aboutText) {
            profile.about = aboutText.textContent.trim();
        }
    }

    // Look for email in contact info or about
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
    const pageText = document.body.innerText;
    const emails = pageText.match(emailRegex);
    if (emails && emails.length > 0) {
        // Filter out obvious non-personal emails
        const validEmails = emails.filter(e =>
            !e.includes('linkedin.com') &&
            !e.includes('example.com') &&
            !e.includes('@email.')
        );
        if (validEmails.length > 0) {
            profile.email = validEmails[0];
        }
    }

    // Look for phone numbers
    const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phones = pageText.match(phoneRegex);
    if (phones && phones.length > 0) {
        profile.phone = phones[0];
    }

    return profile;
}

// Add floating button on LinkedIn profiles
function addFloatingButton() {
    if (!window.location.href.includes('/in/')) return;
    if (document.getElementById('dataforge-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'dataforge-btn';
    btn.innerHTML = '⚡';
    btn.title = 'Save to DataForge';
    btn.onclick = () => {
        const profile = scrapeCurrentProfile();
        if (profile) {
            saveToDataForge(profile);
        }
    };
    document.body.appendChild(btn);
}

// Save profile directly from page
async function saveToDataForge(profile) {
    const btn = document.getElementById('dataforge-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳';

    try {
        const response = await fetch('http://localhost:3001/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...profile,
                source: 'chrome_extension'
            })
        });

        if (response.ok) {
            btn.innerHTML = '✅';
            showNotification('Profile saved to DataForge!');
        } else {
            throw new Error('Failed');
        }
    } catch (error) {
        btn.innerHTML = '❌';
        showNotification('Failed to save. Is DataForge running?', 'error');
    }

    setTimeout(() => { btn.innerHTML = originalText; }, 2000);
}

// Show notification
function showNotification(message, type = 'success') {
    const existing = document.getElementById('dataforge-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'dataforge-notification';
    notif.className = type;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => notif.remove(), 3000);
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addFloatingButton);
} else {
    addFloatingButton();
}

// Re-add button on navigation (LinkedIn is SPA)
let lastUrl = window.location.href;
new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setTimeout(addFloatingButton, 1000);
    }
}).observe(document.body, { childList: true, subtree: true });
