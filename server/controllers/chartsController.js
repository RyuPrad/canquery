const catchAsync = require('../utils/catchAsync');
const chartService = require('../services/chartService');
const { envelope } = require('../utils/envelope');
const { queryProvenanceMeta } = require('../services/resourceEnvelopes');

const meta = result => ({ query_mode: result.query_mode, snapshot: result.snapshot, retrieved_at: result.retrieved_at,
    publisher_modified_at: result.publisher_modified_at, ...queryProvenanceMeta(result.provenance) });

// The website marks reads a visitor did not ask for (a later look in the same
// visit, cards scrolled past) as background reads: they neither renew the copy
// nor count towards popularity.
const isBackgroundRead = req => req.get('X-CanQuery-Read') === 'background';

// GET /web-api/v1/resources/:id/charts — the charts of a table, chosen and
// computed by the chart engine, on the rows the page's search and filters leave.
async function getCharts(req, res) {
    const { q, filters, lang, purpose, limit, snapshot } = req.query;
    const result = await chartService.resourceCharts(req.params.id, { q, filters, lang, purpose, limit, snapshot },
        { ...(isBackgroundRead(req) ? { touch: false, log: false } : {}), client: req.ip });
    res.set('Cache-Control', 'no-cache');
    res.json(envelope({ engine: result.engine, status: result.status, kpis: result.kpis, charts: result.charts, skipped: result.skipped,
        blocked: result.blocked, sums_withheld: result.sums_withheld === true, model: result.model, builder: result.builder, scope: result.scope },
    { meta: meta(result) }));
}

// GET /web-api/v1/resources/:id/charts/custom?spec=<json> — one chart from the custom builder.
async function getCustomChart(req, res) {
    const { spec, q, filters, lang, snapshot } = req.query;
    const result = await chartService.resourceCustomChart(req.params.id, { spec, q, filters, lang, snapshot }, { client: req.ip });
    res.set('Cache-Control', 'no-cache');
    res.json(envelope({ chart: result.chart, reason: result.reason }, { meta: meta(result) }));
}

module.exports = { getCharts: catchAsync(getCharts), getCustomChart: catchAsync(getCustomChart) };
