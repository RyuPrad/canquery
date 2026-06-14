const catchAsync = require('../utils/catchAsync');
const queryService = require('../services/queryService');
const { envelope } = require('../utils/envelope');

async function queryResource(req, res) {
    const { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket } = req.query;
    const result = await queryService.queryResource(req.params.id, { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(envelope(
        { fields: result.fields, records: result.records, total: result.total },
        { meta: Object.assign({ query_mode: result.query_mode }, result.aggregation ? { aggregation: result.aggregation } : {}) }
    ));
}

function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

async function profileResource(req, res) {
    const result = await queryService.profileResource(req.params.id);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(
        { row_count: result.row_count, columns: result.columns },
        { meta: { query_mode: result.query_mode } }
    ));
}

async function exportResourceCsv(req, res) {
    const { q, filters, sort, group_by, agg, agg_column, bucket } = req.query;
    const { fields, records } = await queryService.queryResourceForExport(req.params.id, { q, filters, sort, group_by, agg, agg_column, bucket });
    const cols = fields.map(f => f.id);
    const lines = [cols.map(csvEscape).join(',')];
    for (const record of records) {
        lines.push(cols.map(c => csvEscape(record[c])).join(','));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="resource-' + req.params.id + '.csv"');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(lines.join('\n') + '\n');
}

module.exports = { queryResource: catchAsync(queryResource), profileResource: catchAsync(profileResource), exportResourceCsv: catchAsync(exportResourceCsv) };
