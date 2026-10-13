const rateLimit = require('express-rate-limit');

// These routes otherwise reach signature verification or durable auth
// throttling before the general /api limiter. Shed abusive traffic in memory
// first; the existing durable limits remain authoritative for valid traffic.
const authAbuseLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication requests, try again later' }
});
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many webhook requests, try again later' }
});

module.exports = { authAbuseLimiter, webhookLimiter };
