const rateLimit = require('express-rate-limit');
const TILE_PATH = /^\/(?:web-api|api)\/v1\/resources\/[^/]+\/map\/tiles\/[^/]+\/\d+\/\d+\/\d+\.pbf$/;
const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => Boolean(req.commercial) || TILE_PATH.test(String(req.originalUrl || req.url).split('?')[0])
});
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
const ingestLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many ingest requests, try again later' } });
const profileLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many profile requests, try again later' } });
const exportLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many export requests, try again later' } });
const mapLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many map requests, try again later' } });
const tileLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many map tile requests, try again later' } });
const aggregateRateLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many aggregation requests, try again later' } });

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

module.exports = {
    generalLimiter, authAbuseLimiter, webhookLimiter, ingestLimiter, profileLimiter,
    exportLimiter, mapLimiter, tileLimiter, aggregationLimiter
};
