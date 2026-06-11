const catchAsync = require('../utils/catchAsync');
const queryService = require('../services/queryService');
const { envelope } = require('../utils/envelope');

async function queryResource(req, res) {
    const { q, filters, sort, limit, offset } = req.query;
    const result = await queryService.queryResource(req.params.id, { q, filters, sort, limit, offset });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(envelope(
        { fields: result.fields, records: result.records, total: result.total },
        { meta: { query_mode: result.query_mode } }
    ));
}

module.exports = { queryResource: catchAsync(queryResource) };
