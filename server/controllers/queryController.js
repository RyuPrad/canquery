const catchAsync = require('../utils/catchAsync');
const queryService = require('../services/queryService');
const { envelope } = require('../utils/envelope');

const NUMERIC_TYPE_RE = /^(smallint|integer|bigint|int[248]?|numeric|decimal|real|float[48]?|double( precision)?|money)$/i;
const NEGATIVE_NUMBER_RE = /^-(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

function provenanceMeta(provenance) {
    const sources = provenance && Array.isArray(provenance.sources) ? provenance.sources : [];
    const primary = sources.find(source => source.authoritative) || sources[0] || null;
    return {
        provenance: provenance || { sources: [], primary_license: null },
        sources: sources.map(source => source.id),
        upstream: primary ? primary.upstream : null,
        license: provenance && provenance.primary_license ? provenance.primary_license.title.en : null
    };
}

function hasSpreadsheetFormulaPrefix(value) {
    const trimmed = value.trimStart();
    const leading = value.slice(0, value.length - trimmed.length);
    // Preserve protection for any hidden leading control, including DEL, and
    // catch a formula marker behind ASCII or Unicode whitespace.
    for (const character of leading) {
        const code = character.charCodeAt(0);
        if (code <= 0x1f || code === 0x7f) return true;
    }
    return trimmed.length > 0 && '=+-@'.includes(trimmed[0]);
}

async function queryResource(req, res) {
    const { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket } = req.query;
    const result = await queryService.queryResource(req.params.id, { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(envelope(
        { fields: result.fields, records: result.records, total: result.total },
        { meta: Object.assign(
            { query_mode: result.query_mode },
            provenanceMeta(result.provenance),
            result.aggregation ? { aggregation: result.aggregation } : {}
        ) }
    ));
}

function csvEscape(v, spreadsheetSafe = false) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // CSV syntax escaping does not stop spreadsheet applications from treating
    // attacker-controlled text as a formula. A leading apostrophe forces text
    // interpretation. The caller exempts only validated negative values from
    // numeric fields so legitimate negatives stay numeric when the CSV opens.
    if (spreadsheetSafe && hasSpreadsheetFormulaPrefix(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function waitForDrain(res) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            res.off('drain', onDrain);
            res.off('close', onClose);
            res.off('error', onError);
        };
        const onDrain = () => { cleanup(); resolve(true); };
        const onClose = () => { cleanup(); resolve(false); };
        const onError = (err) => { cleanup(); reject(err); };
        res.once('drain', onDrain);
        res.once('close', onClose);
        res.once('error', onError);
        if (res.destroyed) onClose();
    });
}

async function writeCsvLine(res, values) {
    if (res.destroyed) return false;
    if (res.write(values.join(',') + '\n')) return true;
    return waitForDrain(res);
}

function shouldNeutralizeCell(field, value) {
    // The only dangerous-prefix exemption is a syntactically valid negative
    // number in a numeric column. Fail closed when metadata is absent or an
    // allegedly numeric cell actually contains formula-like text.
    return !(NUMERIC_TYPE_RE.test(String(field.type || '').trim()) && NEGATIVE_NUMBER_RE.test(String(value)));
}

async function profileResource(req, res) {
    const result = await queryService.profileResource(req.params.id);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(
        { row_count: result.row_count, columns: result.columns },
        { meta: { query_mode: result.query_mode, ...provenanceMeta(result.provenance) } }
    ));
}

async function exportResourceCsv(req, res) {
    const { q, filters, sort, group_by, agg, agg_column, bucket } = req.query;
    const { fields, records, provenance } = await queryService.queryResourceForExport(req.params.id, { q, filters, sort, group_by, agg, agg_column, bucket });
    const safeFilenameId = String(req.params.id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="resource-' + safeFilenameId + '.csv"');
    res.set('Cache-Control', 'public, max-age=60');
    const sourceIds = (provenance && provenance.sources || []).map(source => source.id);
    if (sourceIds.length) res.set('X-CanQuery-Sources', sourceIds.join(','));
    if (provenance && provenance.primary_license && provenance.primary_license.url) {
        res.set('Link', '<' + provenance.primary_license.url + '>; rel="license"');
    }

    // Write one line at a time and respect socket backpressure. Local store
    // exports arrive as bounded database batches; datastore proxy results are
    // still bounded by EXPORT_MAX_ROWS at the upstream request.
    if (!await writeCsvLine(res, fields.map(field => csvEscape(field.id, true)))) return;
    for await (const record of records) {
        const values = fields.map(field => csvEscape(record[field.id], shouldNeutralizeCell(field, record[field.id])));
        if (!await writeCsvLine(res, values)) return;
    }
    res.end();
}

module.exports = { queryResource: catchAsync(queryResource), profileResource: catchAsync(profileResource), exportResourceCsv: catchAsync(exportResourceCsv) };
