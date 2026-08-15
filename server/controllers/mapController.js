const catchAsync = require('../utils/catchAsync');
const mapService = require('../services/mapService');
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

module.exports = { getResourceMap };
