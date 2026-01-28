/**
 * Campaign Scheduler
 * Manages scheduled campaign execution using node-cron
 */

const cron = require('node-cron');
const db = require('../database');

class CampaignScheduler {
    constructor() {
        this.scheduledJobs = new Map();
        this.emailSender = null;
        this.linkedinAuto = null;
        this.whatsappAuto = null;
    }

    setModules(emailSender, linkedinAuto, whatsappAuto) {
        this.emailSender = emailSender;
        this.linkedinAuto = linkedinAuto;
        this.whatsappAuto = whatsappAuto;
    }

    // Schedule a campaign for a specific time
    scheduleOnce(campaignId, scheduledTime) {
        const date = new Date(scheduledTime);
        const now = new Date();

        if (date <= now) {
            return { success: false, error: 'Scheduled time must be in the future' };
        }

        const delay = date.getTime() - now.getTime();

        const timeoutId = setTimeout(async () => {
            await this.executeCampaign(campaignId);
            this.scheduledJobs.delete(campaignId);
        }, delay);

        this.scheduledJobs.set(campaignId, { type: 'once', timeoutId, scheduledTime });

        db.updateCampaign(campaignId, {
            scheduled_at: scheduledTime,
            status: 'scheduled'
        });
        db.logActivity('campaign_scheduled', `Campaign ${campaignId} scheduled for ${scheduledTime}`);

        return { success: true, scheduledTime };
    }

    // Schedule a recurring campaign using cron expression
    scheduleRecurring(campaignId, cronExpression, options = {}) {
        if (!cron.validate(cronExpression)) {
            return { success: false, error: 'Invalid cron expression' };
        }

        if (this.scheduledJobs.has(campaignId)) {
            this.cancel(campaignId);
        }

        const job = cron.schedule(cronExpression, async () => {
            if (options.maxRuns && this.getRunCount(campaignId) >= options.maxRuns) {
                this.cancel(campaignId);
                return;
            }
            await this.executeCampaign(campaignId);
        }, {
            timezone: options.timezone || 'UTC'
        });

        this.scheduledJobs.set(campaignId, {
            type: 'recurring',
            job,
            cronExpression,
            runCount: 0,
            maxRuns: options.maxRuns || null
        });

        db.updateCampaign(campaignId, {
            settings: JSON.stringify({
                ...JSON.parse(db.getCampaign(campaignId).settings || '{}'),
                cronExpression,
                maxRuns: options.maxRuns
            }),
            status: 'scheduled'
        });
        db.logActivity('campaign_recurring', `Campaign ${campaignId} scheduled: ${cronExpression}`);

        return { success: true, cronExpression };
    }

    // Schedule campaign for specific days and times
    scheduleDaily(campaignId, times, days = [1, 2, 3, 4, 5]) {
        // times: ['09:00', '14:00'] - array of HH:MM
        // days: [1,2,3,4,5] - Mon-Fri (0=Sun, 1=Mon, etc.)

        const daysStr = days.join(',');
        const schedules = [];

        times.forEach(time => {
            const [hour, minute] = time.split(':');
            const cronExpr = `${minute} ${hour} * * ${daysStr}`;

            const job = cron.schedule(cronExpr, async () => {
                await this.executeCampaign(campaignId);
            });

            schedules.push({ time, job, cronExpr });
        });

        this.scheduledJobs.set(campaignId, {
            type: 'daily',
            schedules,
            times,
            days
        });

        db.updateCampaign(campaignId, {
            settings: JSON.stringify({
                ...JSON.parse(db.getCampaign(campaignId).settings || '{}'),
                scheduleTimes: times,
                scheduleDays: days
            }),
            status: 'scheduled'
        });

        return { success: true, times, days };
    }

    // Execute a campaign
    async executeCampaign(campaignId) {
        const campaign = db.getCampaign(campaignId);
        if (!campaign) return { error: 'Campaign not found' };

        db.logActivity('campaign_started', `Campaign ${campaign.name} execution started`);

        try {
            let result;

            if (campaign.type === 'email' && this.emailSender) {
                result = await this.emailSender.sendCampaign(campaignId);
            } else if (campaign.type === 'linkedin' && this.linkedinAuto) {
                result = await this.linkedinAuto.runCampaign(campaignId);
            } else if (campaign.type === 'whatsapp' && this.whatsappAuto) {
                result = await this.whatsappAuto.runCampaign(campaignId);
            } else {
                return { error: 'Campaign type not configured' };
            }

            // Update run count for recurring jobs
            const jobInfo = this.scheduledJobs.get(campaignId);
            if (jobInfo?.type === 'recurring') {
                jobInfo.runCount = (jobInfo.runCount || 0) + 1;
            }

            db.logActivity('campaign_completed', `Campaign ${campaign.name} completed`, result);
            return result;
        } catch (error) {
            db.logActivity('campaign_error', `Campaign ${campaign.name} failed: ${error.message}`);
            return { error: error.message };
        }
    }

    // Cancel a scheduled campaign
    cancel(campaignId) {
        const jobInfo = this.scheduledJobs.get(campaignId);
        if (!jobInfo) return { success: false, error: 'No scheduled job found' };

        if (jobInfo.type === 'once') {
            clearTimeout(jobInfo.timeoutId);
        } else if (jobInfo.type === 'recurring') {
            jobInfo.job.stop();
        } else if (jobInfo.type === 'daily') {
            jobInfo.schedules.forEach(s => s.job.stop());
        }

        this.scheduledJobs.delete(campaignId);
        db.updateCampaign(campaignId, { status: 'draft' });
        db.logActivity('campaign_cancelled', `Campaign ${campaignId} schedule cancelled`);

        return { success: true };
    }

    // Get scheduled jobs info
    getScheduledJobs() {
        const jobs = [];
        this.scheduledJobs.forEach((info, campaignId) => {
            const campaign = db.getCampaign(campaignId);
            jobs.push({
                campaignId,
                campaignName: campaign?.name,
                type: info.type,
                ...(info.scheduledTime && { scheduledTime: info.scheduledTime }),
                ...(info.cronExpression && { cronExpression: info.cronExpression }),
                ...(info.times && { times: info.times, days: info.days }),
                ...(info.runCount !== undefined && { runCount: info.runCount }),
                ...(info.maxRuns && { maxRuns: info.maxRuns })
            });
        });
        return jobs;
    }

    getRunCount(campaignId) {
        const jobInfo = this.scheduledJobs.get(campaignId);
        return jobInfo?.runCount || 0;
    }

    // Restore scheduled jobs from database on startup
    restoreSchedules() {
        const campaigns = db.getCampaigns({ status: 'scheduled' });
        let restored = 0;

        campaigns.forEach(campaign => {
            try {
                const settings = JSON.parse(campaign.settings || '{}');

                if (campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date()) {
                    this.scheduleOnce(campaign.id, campaign.scheduled_at);
                    restored++;
                } else if (settings.cronExpression) {
                    this.scheduleRecurring(campaign.id, settings.cronExpression, {
                        maxRuns: settings.maxRuns
                    });
                    restored++;
                } else if (settings.scheduleTimes && settings.scheduleDays) {
                    this.scheduleDaily(campaign.id, settings.scheduleTimes, settings.scheduleDays);
                    restored++;
                }
            } catch (e) {
                console.error(`Failed to restore schedule for campaign ${campaign.id}:`, e);
            }
        });

        if (restored > 0) {
            console.log(`✅ Restored ${restored} scheduled campaigns`);
        }
    }

    // Stop all scheduled jobs
    stopAll() {
        this.scheduledJobs.forEach((info, campaignId) => {
            this.cancel(campaignId);
        });
    }
}

module.exports = new CampaignScheduler();
