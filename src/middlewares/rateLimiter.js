const logger = require('../config/logger');

class RateLimiter {
    constructor() {
        // Store attempts in memory with timestamps
        this.attempts = new Map();
        // Maximum attempts allowed per window
        this.maxAttempts = 5;
        // Time window in milliseconds (15 minutes)
        this.windowMs = 15 * 60 * 1000;
    }

    // Clean up old attempts
    cleanup() {
        const now = Date.now();
        for (const [key, value] of this.attempts.entries()) {
            if (now - value.timestamp > this.windowMs) {
                this.attempts.delete(key);
            }
        }
    }

    // Check if an IP has exceeded the rate limit
    isRateLimited(ip) {
        this.cleanup();
        const now = Date.now();
        const attempt = this.attempts.get(ip);

        if (!attempt) {
            this.attempts.set(ip, { count: 1, timestamp: now });
            return false;
        }

        if (now - attempt.timestamp > this.windowMs) {
            // Reset if window has passed
            this.attempts.set(ip, { count: 1, timestamp: now });
            return false;
        }

        if (attempt.count >= this.maxAttempts) {
            logger.warn(`Rate limit exceeded for IP: ${ip}`);
            return true;
        }

        attempt.count++;
        return false;
    }

    // Reset attempts for an IP (useful after successful login)
    reset(ip) {
        this.attempts.delete(ip);
    }

    // For testing purposes
    clear() {
        this.attempts.clear();
    }
}

// Create a singleton instance
const rateLimiter = new RateLimiter();

const rateLimiterMiddleware = (req, res, next) => {
    // Get IP address from request
    const ip = req.ip || req.connection.remoteAddress;

    if (rateLimiter.isRateLimited(ip)) {
        res.status(429).json({
            error: 'Too many attempts. Please try again later.',
            retryAfter: Math.ceil(rateLimiter.windowMs / 1000)
        });
        return;
    }

    // Add reset function to response for successful logins
    res.resetRateLimit = () => rateLimiter.reset(ip);
    next();
};

module.exports = {
    rateLimiterMiddleware,
    RateLimiter,
    rateLimiter // Export for testing
}; 