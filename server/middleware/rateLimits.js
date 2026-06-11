const rateLimit = require('express-rate-limit');
const generalLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const ingestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many ingest requests, try again later' } });
module.exports = { generalLimiter, ingestLimiter };
