const rateLimit = require('express-rate-limit');
const generalLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const ingestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many ingest requests, try again later' } });
const profileLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many profile requests, try again later' } });
const exportLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many export requests, try again later' } });
const aggregateRateLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many aggregation requests, try again later' } });

// Ordinary table pagination remains under the general API limit. Only requests
// that ask Postgres to group/aggregate consume the tighter expensive-query
// bucket.
function aggregationLimiter(req, res, next) {
    const { group_by, agg, agg_column, bucket } = req.query;
    if ([group_by, agg, agg_column, bucket].every(v => v === undefined || v === null || v === '')) {
        return next();
    }
    return aggregateRateLimiter(req, res, next);
}

module.exports = { generalLimiter, ingestLimiter, profileLimiter, exportLimiter, aggregationLimiter };
