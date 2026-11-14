const rateLimit = require('express-rate-limit');
const TILE_PATH = /^\/(?:web-api|api)\/v1\/resources\/[^/]+\/map\/tiles\/[^/]+\/\d+\/\d+\/\d+\.pbf$/;
const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => Boolean(req.commercial) || TILE_PATH.test(String(req.originalUrl || req.url).split('?')[0])
});
const ingestLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many ingest requests, try again later' } });
const profileLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many profile requests, try again later' } });
const exportLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many export requests, try again later' } });
const mapLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many map requests, try again later' } });
const tileLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many map tile requests, try again later' } });
const previewLimiter = rateLimit({ skip: req => Boolean(req.commercial), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many preview requests, try again later' } });
// The website's whole-table read: a person opens far fewer tables than this,
// and it matches the CSV export's rate.
const tableRowsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many table requests, try again later' } });
// The Chart tab asks once per table and once more per search or filter; the
// custom builder asks on every change of its controls. Cached answers count too.
const chartsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many chart requests, try again later' } });
const customChartLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many chart requests, try again later' } });
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
    generalLimiter, ingestLimiter, profileLimiter, previewLimiter,
    exportLimiter, mapLimiter, tileLimiter, aggregationLimiter, tableRowsLimiter, chartsLimiter, customChartLimiter
};
