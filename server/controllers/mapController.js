const catchAsync = require('../utils/catchAsync');
const mapService = require('../services/mapService');
const pmtilesMapService = require('../services/pmtilesMapService');
const { getResourceMapById } = require('../db/catalogReadQueries');
const AppError = require('../utils/AppError');
const { envelope } = require('../utils/envelope');

const getResourceMap = catchAsync(async (req, res) => {
    const result = await mapService.queryMap(req.params.id, req.query);
    const primary = result.provenance.sources.find(source => source.authoritative) || result.provenance.sources[0];
    res.set('Cache-Control', 'public, max-age=60');
    res.json(envelope(result.data, {
        meta: {
            map: result.map,
            provenance: result.provenance,
            sources: result.provenance.sources.map(source => source.id),
            upstream: primary ? primary.upstream : null,
            license: result.provenance.primary_license ? result.provenance.primary_license.title.en : null
        }
    }));
});

const getResourceMapTile = catchAsync(async (req, res) => {
    const row = await getResourceMapById(req.params.id);
    if (!row || row.provider !== 'pmtiles') {
        throw new AppError('Map tile not found', 404);
    }
    const tile = await pmtilesMapService.getTile(row, req.params);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (!tile) return res.status(204).end();
    res.type('application/x-protobuf');
    res.send(tile);
});

module.exports = { getResourceMap, getResourceMapTile };
