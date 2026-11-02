const catchAsync = require('../utils/catchAsync');
const tableRows = require('../services/tableRows');
const AppError = require('../utils/AppError');

// GET /web-api/v1/resources/:id/rows — the website's in-browser table. Only
// the site's own pages may ask: browsers send Sec-Fetch-Site on every fetch,
// and this whole-table read is not part of the developer API.
async function getRows(req, res) {
    res.set('Cache-Control', 'no-store');
    if (req.get('Sec-Fetch-Site') !== 'same-origin') {
        const error = new AppError('This endpoint serves the CanQuery website only', 403);
        error.publicCode = 'SAME_ORIGIN_REQUIRED';
        throw error;
    }
    const result = await tableRows.readTableRows(req.params.id, { snapshot: req.query.snapshot });
    res.set('Cache-Control', result.cacheControl);
    res.set('X-CanQuery-Retrieved-At', result.retrievedAt);
    res.type('application/json').send(result.body);
}

module.exports = { getRows: catchAsync(getRows) };
