const catchAsync = require('../utils/catchAsync');
const catalogService = require('../services/catalogService');
const { envelope } = require('../utils/envelope');
const AppError = require('../utils/AppError');

const cleanStr = (v) => {
    if (typeof v === 'string' && v.trim() !== '') {
        const trimmed = v.trim();
        if (trimmed.length > 200) throw new AppError('Query parameter too long', 400);
        return trimmed;
    }
    return undefined;
};

const listDatasets = async (req, res) => {
    const { q, org, format, keyword, place, source, mappable, limit, cursor } = req.query;
    const result = await catalogService.searchDatasets({
        q: cleanStr(q),
        org: cleanStr(org),
        format: cleanStr(format),
        keyword: cleanStr(keyword),
        place: cleanStr(place),
        source: cleanStr(source),
        mappable,
        limit,
        cursor
    });
    res.set('Cache-Control', 'public, max-age=300');
    const sources = Array.from(new Set(result.items.flatMap(item => item.provenance.sources.map(source => source.id))));
    res.json(envelope(result.items, { nextCursor: result.nextCursor, meta: { sources } }));
};

const provenanceMeta = (value) => {
    const sources = value && value.provenance && value.provenance.sources || [];
    const primary = sources.find(source => source.authoritative) || sources[0];
    return {
        sources: sources.map(source => source.id),
        upstream: primary ? primary.upstream : null,
        license: value && value.provenance && value.provenance.primary_license
            ? value.provenance.primary_license.title.en
            : null
    };
};

const getDataset = async (req, res) => {
    const dataset = await catalogService.getDataset(req.params.idOrName);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(dataset, { meta: provenanceMeta(dataset) }));
};

const getResource = async (req, res) => {
    const resource = await catalogService.getResource(req.params.id);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(resource, { meta: provenanceMeta(resource) }));
};

const listOrganizations = async (req, res) => {
    const result = await catalogService.listOrganizations({
        source: cleanStr(req.query.source),
        place: cleanStr(req.query.place),
        limit: req.query.limit,
        cursor: req.query.cursor
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { nextCursor: result.nextCursor }));
};

const listSources = async (req, res) => {
    const items = await catalogService.listSources({ place: cleanStr(req.query.place) });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(items, { meta: { sources: items.map(item => item.id) } }));
};

const listPlaces = async (req, res) => {
    const result = await catalogService.listPlaces({
        q: cleanStr(req.query.q),
        kind: cleanStr(req.query.kind),
        parent: cleanStr(req.query.parent),
        limit: req.query.limit,
        cursor: req.query.cursor
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { nextCursor: result.nextCursor }));
};

const getPlace = async (req, res) => {
    const place = await catalogService.getPlace(req.params.idOrSlug);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(place));
};

const getStats = async (req, res) => {
    const stats = await catalogService.getStats();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(stats));
};

const getRecentlyUnlocked = async (req, res) => {
    const items = await catalogService.recentlyUnlocked(req.query.limit, cleanStr(req.query.place));
    res.set('Cache-Control', 'public, max-age=60');
    res.json(envelope(items));
};

const getPopular = async (req, res) => {
    const items = await catalogService.popularResources({
        days: req.query.days,
        limit: req.query.limit,
        place: cleanStr(req.query.place)
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(items));
};

const healthz = async (req, res) => {
    const health = await catalogService.healthz();
    res.set('Cache-Control', 'no-store');
    res.status(health.ok ? 200 : 503).json(health);
};

const getOps = async (req, res) => {
    const status = await catalogService.opsStatus();
    res.set('Cache-Control', 'no-store');
    res.status(status.ok ? 200 : 503).json(envelope(status));
};

module.exports = {
    listDatasets: catchAsync(listDatasets),
    getDataset: catchAsync(getDataset),
    getResource: catchAsync(getResource),
    listOrganizations: catchAsync(listOrganizations),
    listSources: catchAsync(listSources),
    listPlaces: catchAsync(listPlaces),
    getPlace: catchAsync(getPlace),
    getStats: catchAsync(getStats),
    getRecentlyUnlocked: catchAsync(getRecentlyUnlocked),
    getPopular: catchAsync(getPopular),
    healthz: catchAsync(healthz),
    getOps: catchAsync(getOps)
};
