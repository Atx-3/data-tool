/**
 * Proxy Manager
 * Manages proxy rotation for web scraping
 */

const axios = require('axios');

class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentIndex = 0;
        this.proxyStats = new Map();
        this.enabled = false;
    }

    // Initialize proxy manager
    init(config = {}) {
        this.enabled = config.enabled || false;
        this.rotationStrategy = config.rotationStrategy || 'round-robin'; // round-robin, random, least-used
        this.testUrl = config.testUrl || 'https://httpbin.org/ip';
        this.timeout = config.timeout || 10000;
        this.maxFailures = config.maxFailures || 3;
    }

    // Add proxies from list
    addProxies(proxyList) {
        proxyList.forEach(proxy => {
            const parsed = this.parseProxy(proxy);
            if (parsed) {
                this.proxies.push(parsed);
                this.proxyStats.set(parsed.url, {
                    successes: 0,
                    failures: 0,
                    lastUsed: null,
                    avgResponseTime: 0
                });
            }
        });
        return this.proxies.length;
    }

    // Parse proxy string to object
    parseProxy(proxyStr) {
        try {
            // Formats: 
            // ip:port
            // ip:port:user:pass
            // protocol://ip:port
            // protocol://user:pass@ip:port

            let protocol = 'http';
            let host, port, username, password;

            if (proxyStr.includes('://')) {
                const url = new URL(proxyStr);
                protocol = url.protocol.replace(':', '');
                host = url.hostname;
                port = url.port;
                username = url.username || null;
                password = url.password || null;
            } else {
                const parts = proxyStr.split(':');
                if (parts.length === 2) {
                    [host, port] = parts;
                } else if (parts.length === 4) {
                    [host, port, username, password] = parts;
                } else {
                    return null;
                }
            }

            const proxyUrl = username
                ? `${protocol}://${username}:${password}@${host}:${port}`
                : `${protocol}://${host}:${port}`;

            return {
                url: proxyUrl,
                host,
                port: parseInt(port),
                protocol,
                username,
                password
            };
        } catch (e) {
            console.error('Failed to parse proxy:', proxyStr, e.message);
            return null;
        }
    }

    // Get next proxy based on strategy
    getProxy() {
        if (!this.enabled || this.proxies.length === 0) {
            return null;
        }

        let proxy;

        switch (this.rotationStrategy) {
            case 'random':
                proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
                break;

            case 'least-used':
                // Sort by success count (ascending) and pick first
                const sorted = [...this.proxies].sort((a, b) => {
                    const statsA = this.proxyStats.get(a.url);
                    const statsB = this.proxyStats.get(b.url);
                    return (statsA?.successes || 0) - (statsB?.successes || 0);
                });
                proxy = sorted[0];
                break;

            case 'round-robin':
            default:
                proxy = this.proxies[this.currentIndex];
                this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
                break;
        }

        if (proxy) {
            const stats = this.proxyStats.get(proxy.url);
            if (stats) {
                stats.lastUsed = new Date();
            }
        }

        return proxy;
    }

    // Record proxy success
    recordSuccess(proxyUrl, responseTime) {
        const stats = this.proxyStats.get(proxyUrl);
        if (stats) {
            stats.successes++;
            stats.failures = 0; // Reset failures on success
            stats.avgResponseTime = (stats.avgResponseTime * (stats.successes - 1) + responseTime) / stats.successes;
        }
    }

    // Record proxy failure
    recordFailure(proxyUrl) {
        const stats = this.proxyStats.get(proxyUrl);
        if (stats) {
            stats.failures++;

            // Remove proxy if too many failures
            if (stats.failures >= this.maxFailures) {
                this.removeProxy(proxyUrl);
            }
        }
    }

    // Remove a proxy
    removeProxy(proxyUrl) {
        const index = this.proxies.findIndex(p => p.url === proxyUrl);
        if (index !== -1) {
            this.proxies.splice(index, 1);
            this.proxyStats.delete(proxyUrl);
            console.log(`Removed failing proxy: ${proxyUrl}`);
        }
    }

    // Test a proxy
    async testProxy(proxy) {
        const startTime = Date.now();
        try {
            const response = await axios.get(this.testUrl, {
                proxy: {
                    host: proxy.host,
                    port: proxy.port,
                    protocol: proxy.protocol,
                    auth: proxy.username ? {
                        username: proxy.username,
                        password: proxy.password
                    } : undefined
                },
                timeout: this.timeout
            });

            const responseTime = Date.now() - startTime;
            return {
                working: true,
                responseTime,
                ip: response.data?.origin || 'unknown'
            };
        } catch (e) {
            return {
                working: false,
                error: e.message
            };
        }
    }

    // Test all proxies
    async testAllProxies() {
        const results = [];
        for (const proxy of this.proxies) {
            const result = await this.testProxy(proxy);
            results.push({
                proxy: proxy.url,
                ...result
            });
        }
        return results;
    }

    // Get proxy config for Playwright
    getPlaywrightConfig() {
        const proxy = this.getProxy();
        if (!proxy) return null;

        return {
            server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password
        };
    }

    // Get proxy config for Axios
    getAxiosConfig() {
        const proxy = this.getProxy();
        if (!proxy) return null;

        return {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            auth: proxy.username ? {
                username: proxy.username,
                password: proxy.password
            } : undefined
        };
    }

    // Get stats
    getStats() {
        const stats = [];
        this.proxyStats.forEach((stat, url) => {
            stats.push({
                proxy: url,
                ...stat
            });
        });
        return {
            enabled: this.enabled,
            totalProxies: this.proxies.length,
            strategy: this.rotationStrategy,
            proxies: stats
        };
    }

    // Import from file content
    importFromText(text) {
        const lines = text.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        return this.addProxies(lines);
    }

    // Clear all proxies
    clear() {
        this.proxies = [];
        this.proxyStats.clear();
        this.currentIndex = 0;
    }

    // Export proxy list
    export() {
        return this.proxies.map(p => p.url).join('\n');
    }
}

module.exports = new ProxyManager();
