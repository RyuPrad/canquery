const seo = require('./seoMeta');

// The first rows of a resource's table in the page HTML, for crawlers that do
// not run the application (React replaces the snapshot for everyone else).
// Three sources share one shape: { fields: [{ id, label, type }], records:
// [[string|null]], columns_total, upstream_total }. A live DataStore table and
// the start of a CSV are read by scripts/sample-resource-rows.js and stored;
// a prepared copy's rows are the ones the page already read for its embedded
// first page. Everything is bounded: rows, columns, cell length, the stored
// JSON and the escaped HTML.
const SAMPLE_ROWS = 10;
const SAMPLE_COLUMNS = 20;
const CELL_CHARS = 200;
const STORED_JSON_BYTES = 32 * 1024;
const TABLE_HTML_BYTES = 24 * 1024;
const HIDDEN_FIELDS = new Set(['_id', '_full_text']);

const pad = value => String(value).padStart(2, '0');

// A cell as display text: control characters become spaces, runs of space
// collapse, and long values are cut on whole characters. Dates from a prepared
// copy arrive as Date objects: a DATE column at local midnight, a TIMESTAMPTZ
// as an instant.
function cellText(value, type) {
    if (value === null || value === undefined) return null;
    let text;
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) return null;
        text = type === 'DATE'
            ? value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate())
            : value.toISOString();
    } else if (typeof value === 'object') {
        text = JSON.stringify(value);
    } else {
        text = String(value);
    }
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const characters = Array.from(text);
    return characters.length > CELL_CHARS ? characters.slice(0, CELL_CHARS - 1).join('') + '…' : text;
}

function labelText(value, fallback) {
    return cellText(value, 'TEXT') || fallback;
}

// Keeps at most SAMPLE_COLUMNS columns and SAMPLE_ROWS rows, then drops rows
// from the end until the stored JSON fits. Returns null when nothing fits.
function clampSample({ fields, records, columns_total = fields.length, upstream_total = null }) {
    const kept = fields.slice(0, SAMPLE_COLUMNS);
    const sample = { fields: kept, records: records.slice(0, SAMPLE_ROWS).map(record => record.slice(0, kept.length)),
        columns_total: Math.max(columns_total, kept.length), upstream_total };
    while (sample.records.length && Buffer.byteLength(JSON.stringify(sample)) > STORED_JSON_BYTES) sample.records.pop();
    return kept.length && sample.records.length ? sample : null;
}

function visible(fields) {
    return (Array.isArray(fields) ? fields : []).filter(field => field && field.id && !HIDDEN_FIELDS.has(field.id));
}

// datastore_search's result: fields carry an optional data-dictionary label.
function fromDatastore(result) {
    const fields = visible(result.fields).map(field => ({
        id: String(field.id), label: labelText(field.info && field.info.label, String(field.id)), type: field.type || null
    }));
    const records = (Array.isArray(result.records) ? result.records : [])
        .map(record => fields.map(field => cellText(record[field.id], field.type)));
    const total = Number(result.total);
    return clampSample({ fields, records, upstream_total: Number.isSafeInteger(total) && total >= 0 ? total : null });
}

// csvPreview.previewRecords: inferred types and the publisher's own header.
function fromPreview(preview) {
    const fields = visible(preview.fields).map(field => ({
        id: String(field.id), label: labelText(field.original_label, String(field.id)), type: field.type || null
    }));
    const records = (Array.isArray(preview.records) ? preview.records : [])
        .map(record => fields.map(field => cellText(record[field.id], field.type)));
    return clampSample({ fields, records });
}

// The embedded first page of a prepared copy (resourceInitialData).
function fromPrepared(data, total) {
    const fields = visible(data && data.fields).map(field => ({
        id: String(field.id), label: labelText(field.original_label, String(field.id)), type: field.type || null
    }));
    const records = (Array.isArray(data && data.records) ? data.records : [])
        .map(record => fields.map(field => cellText(record[field.id], field.type)));
    const rows = Number(total);
    return clampSample({ fields, records, upstream_total: Number.isSafeInteger(rows) && rows >= 0 ? rows : null });
}

const ORIGIN_TEXT = {
    datastore: "the publisher's live table",
    file: "the start of the publisher's file",
    prepared: "CanQuery's prepared copy"
};

function caption(sample, origin, readAt, shown) {
    const date = readAt ? new Date(readAt) : null;
    // The read day in UTC, so the page says the same thing on every server.
    const when = date && Number.isFinite(date.getTime()) ? ' on ' + date.toISOString().slice(0, 10) : '';
    const rows = shown === 1 ? 'The first row, as CanQuery read it' : 'The first ' + shown + ' rows, as CanQuery read them';
    const columns = sample.columns_total > sample.fields.length
        ? ' Showing ' + sample.fields.length + ' of ' + sample.columns_total.toLocaleString('en-CA') + ' columns.' : '';
    const total = sample.upstream_total != null && sample.upstream_total > shown
        ? ' The table has ' + sample.upstream_total.toLocaleString('en-CA') + ' rows.' : '';
    return rows + ' from ' + ORIGIN_TEXT[origin] + when + '.' + columns + total;
}

function tableHtml(sample, records, origin, readAt) {
    const esc = seo.escapeHtml;
    const head = sample.fields.map(field => '<th scope="col">' + esc(field.label) + '</th>').join('');
    const body = records.map(record => '<tr>' + record.map(value => '<td>' + (value === null ? '' : esc(value)) + '</td>').join('') + '</tr>').join('');
    return '<section data-cq-sample="' + origin + '"><h2>Sample rows</h2><p>' + esc(caption(sample, origin, readAt, records.length)) +
        '</p><div class="overflow-x-auto"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
}

// The snapshot section, or '' without rows. Rows are dropped from the end
// until the escaped HTML fits its budget.
function renderSampleTable(sample) {
    if (!sample || !ORIGIN_TEXT[sample.origin] || !Array.isArray(sample.fields) || !sample.fields.length) return '';
    const records = Array.isArray(sample.records) ? sample.records.slice(0, SAMPLE_ROWS) : [];
    while (records.length) {
        const html = tableHtml(sample, records, sample.origin, sample.read_at);
        if (Buffer.byteLength(html) <= TABLE_HTML_BYTES) return html;
        records.pop();
    }
    return '';
}

module.exports = {
    cellText, clampSample, fromDatastore, fromPreview, fromPrepared, renderSampleTable,
    SAMPLE_ROWS, SAMPLE_COLUMNS, CELL_CHARS, STORED_JSON_BYTES, TABLE_HTML_BYTES
};
