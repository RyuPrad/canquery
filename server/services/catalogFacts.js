// Reader-facing facts about a dataset or a resource, derived only from catalogue
// rows and the capability classifier: counts, formats, languages, dates and what
// a visitor can do on CanQuery. The <head> builders (titles, descriptions), the
// crawl snapshot and the API presentation layer all read these so every surface
// states the same facts. No database, no filesystem, no Express.
const { plainText, collapse, resourceLanguages } = require('./catalogText');
const { classifyResource } = require('./resourceCapabilities');

const TABLE_CAPABILITIES = new Set(['datastore', 'ingested']);

const pick = (en, fr) => plainText(en) || plainText(fr) || '';

const isMapped = resource => Boolean(resource && (resource.map_provider || (resource.map && resource.map.available)));

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// "Oct 2026" / "oct. 2026": month precision is what a snippet reader needs, and
// it never pretends to know the day a publisher last changed the data itself.
function monthYear(value, lang = 'en') {
    const date = parseDate(value);
    return date
        ? date.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        : null;
}

function isoDate(value) {
    const date = parseDate(value);
    return date ? date.toISOString().slice(0, 10) : null;
}

function humanFileSize(value, lang = 'en') {
    if (value == null || value === '') return null;
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes < 1024) return Math.round(bytes) + (lang === 'fr' ? ' octets' : ' bytes');
    const units = lang === 'fr' ? ['ko', 'Mo', 'Go', 'To'] : ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && amount >= 1024; i += 1) {
        amount /= 1024;
        unit = units[i];
    }
    return (amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)).replace(/\.0$/, '') + ' ' + unit;
}

const formatCount = (value, lang = 'en') => Number(value).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');

// "a", "a and b", "a, b and c" (or "et" in French).
function joinList(parts, lang = 'en') {
    const items = (parts || []).filter(Boolean);
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + (lang === 'fr' ? ' et ' : ' and ') + items[items.length - 1];
}

const plural = (count, singular, pluralForm = singular + 's') => (count === 1 ? singular : pluralForm);

function countFields(resource) {
    if (resource.ingest_status === 'ready' && Array.isArray(resource.ingested_columns) && resource.ingested_columns.length) {
        return resource.ingested_columns.length;
    }
    if (Array.isArray(resource.map_fields) && resource.map_fields.length) return resource.map_fields.length;
    return null;
}

function countRows(resource) {
    if (resource.ingest_status !== 'ready' || resource.ingested_row_count == null) return null;
    const rows = Number(resource.ingested_row_count);
    return Number.isFinite(rows) && rows >= 0 ? rows : null;
}

function datasetFacts(dataset = {}, resources = []) {
    const list = (Array.isArray(resources) ? resources : []).filter(Boolean);
    const formatCounts = new Map();
    const languages = new Set();
    let queryable = 0;
    let loadable = 0;
    let mapped = 0;
    let downloadOnly = 0;
    for (const resource of list) {
        const capability = classifyResource(resource).capability;
        if (TABLE_CAPABILITIES.has(capability)) queryable += 1;
        else if (capability === 'ingestable') loadable += 1;
        else if (capability === 'file-only') downloadOnly += 1;
        if (isMapped(resource)) mapped += 1;
        const format = plainText(resource.format).toUpperCase();
        if (format) formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
        for (const code of resourceLanguages(resource)) languages.add(code);
    }
    const formats = [...formatCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([format]) => format);
    return {
        title: pick(dataset.title_en, dataset.title_fr),
        publisher: pick(dataset.org_title_en, dataset.org_title_fr),
        fileCount: list.length,
        formats,
        topFormats: formats.slice(0, 3),
        queryable,
        loadable,
        mapped,
        downloadOnly,
        bilingual: languages.has('en') && languages.has('fr'),
        updated: monthYear(dataset.metadata_modified),
        updatedDate: isoDate(dataset.metadata_modified)
    };
}

function resourceFacts(resource = {}) {
    const capability = classifyResource(resource).capability;
    return {
        capability,
        table: TABLE_CAPABILITIES.has(capability),
        loadable: capability === 'ingestable',
        mapped: isMapped(resource),
        format: collapse(plainText(resource.format)).toUpperCase(),
        languages: resourceLanguages(resource),
        size: humanFileSize(resource.size_bytes),
        rows: countRows(resource),
        fields: countFields(resource),
        updated: monthYear(resource.last_modified),
        publisher: pick(resource.org_title_en, resource.org_title_fr),
        datasetTitle: pick(resource.dataset_title_en, resource.dataset_title_fr)
    };
}

// Reader words for the capability classifier's internal values.
function accessLabel(capability, { mapped = false } = {}) {
    const map = mapped ? ' and interactive map' : '';
    if (TABLE_CAPABILITIES.has(capability)) return 'Live table (filter, chart, export)' + map;
    if (capability === 'ingestable') return 'Table on demand (prepared when opened)' + map;
    if (capability === 'mapped') return 'Interactive map and original download';
    return 'Original download only';
}

// The table/map word for one resource: "live table", "table", "map",
// "table and map", "live table and map" or "" for a plain download.
function capabilityWord(facts) {
    const table = facts.table ? 'live table' : facts.loadable ? 'table' : '';
    if (table) return facts.mapped ? table + ' and map' : table;
    return facts.mapped ? 'map' : '';
}

// What CanQuery adds for a whole dataset, for titles: "live table and 2 files
// (CSV, XLSX)", "table, map and 3 files", "12 files (PDF)", "PDF file".
function capabilityPhrase(facts, { short = false } = {}) {
    const { queryable, loadable, mapped, fileCount, topFormats } = facts;
    if (!fileCount) return '';
    const formats = !short && topFormats.length ? ' (' + topFormats.join(', ') + ')' : '';
    if (fileCount === 1) {
        const words = [];
        if (queryable) words.push('live table');
        else if (loadable) words.push('table');
        if (mapped) words.push('map');
        if (!words.length) return (topFormats[0] ? topFormats[0] + ' ' : '') + 'file';
        return joinList(words) + formats;
    }
    const parts = [];
    const tables = queryable || loadable;
    if (queryable) parts.push(queryable === 1 ? 'live table' : formatCount(queryable) + ' live tables');
    else if (loadable) parts.push(loadable === 1 ? 'table' : formatCount(loadable) + ' tables');
    if (mapped) parts.push(mapped === 1 ? 'map' : formatCount(mapped) + ' maps');
    // "2 tables (CSV, XLSX)" when every file is a table or a map; otherwise the
    // file total says how much more there is to download.
    if ((tables && tables === fileCount) || (!tables && mapped === fileCount)) return joinList(parts) + formats;
    parts.push(formatCount(fileCount) + ' files' + formats);
    return joinList(parts);
}

// One sentence of actions for a dataset, for descriptions.
function capabilitySentence(facts) {
    const base = facts.queryable
        ? 'Preview the live table, filter, chart and export up to 10,000 rows as CSV'
        : facts.loadable
            ? 'Open as a table, filter, chart and export up to 10,000 rows as CSV'
            : 'View metadata, licence and direct download links';
    return facts.mapped ? 'Explore the interactive map, ' + base.charAt(0).toLowerCase() + base.slice(1) : base;
}

module.exports = {
    TABLE_CAPABILITIES,
    accessLabel,
    capabilityPhrase,
    capabilitySentence,
    capabilityWord,
    datasetFacts,
    formatCount,
    humanFileSize,
    isMapped,
    isoDate,
    joinList,
    monthYear,
    plural,
    resourceFacts
};
