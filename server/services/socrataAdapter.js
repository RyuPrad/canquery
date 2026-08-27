const crypto = require('node:crypto');
const { fetchPublicJson } = require('./publicJson');

// The Discovery API is relevance-ranked and does not expose a stable catalogue
// sort key. Fetch each configured city in one bounded response so an item cannot
// move across offset pages during a sync. Larger future portals fail closed
// instead of risking an incomplete source sweep.
const PAGE_SIZE = 5000;
const MAP_VERSION = 'socrata-pmtiles-v1';
const GEOMETRY_TYPES = new Set([
    'point', 'multipoint', 'line', 'multiline', 'polygon', 'multipolygon',
    // Socrata's legacy location type is emitted as GeoJSON Point geometry.
    'location'
]);
const PUBLISHER_MODES = new Set(['custom-field', 'attribution']);
const LICENSE_MODES = new Set(['custom-field', 'view-license-name']);
const COMPARISONS = new Set(['text', 'url']);

function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function array(value) {
    return Array.isArray(value) ? value : value == null ? [] : [value];
}

function finiteNonNegative(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function timestamp(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    const date = Number.isFinite(number)
        ? new Date(number < 10_000_000_000 ? number * 1000 : number)
        : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function namespace(sourceId, kind, upstreamId) {
    return ['socrata', sourceId, kind, clean(upstreamId).toLowerCase()].join('-');
}

function identityFor(record) {
    return clean(record && record.resource && record.resource.id) || null;
}

function canonicalKey(identity) {
    return clean(identity).toLowerCase();
}

function viewUrl(source, datasetId) {
    return source.homepageUrl.replace(/\/+$/, '') + '/api/views/' + encodeURIComponent(datasetId);
}

function countUrl(source, datasetId) {
    const url = new URL(source.homepageUrl.replace(/\/+$/, '') + '/resource/' +
        encodeURIComponent(datasetId) + '.json');
    url.searchParams.set('$select', 'count(*)');
    return url.href;
}

function csvUrl(source, datasetId) {
    const url = new URL(source.homepageUrl.replace(/\/+$/, '') + '/api/views/' +
        encodeURIComponent(datasetId) + '/rows.csv');
    url.searchParams.set('accessType', 'DOWNLOAD');
    return url.href;
}

function geoJsonBaseUrl(source, datasetId) {
    return source.homepageUrl.replace(/\/+$/, '') + '/resource/' +
        encodeURIComponent(datasetId) + '.geojson';
}

function geoJsonPageUrl(source, datasetId, { limit, offset }) {
    const url = new URL(geoJsonBaseUrl(source, datasetId));
    url.searchParams.set('$limit', String(limit));
    url.searchParams.set('$offset', String(offset));
    // A stable system-row order prevents offset pagination from duplicating or
    // skipping features when the portal's default plan changes.
    url.searchParams.set('$order', ':id');
    return url.href;
}

function customFields(view) {
    const fields = view && view.metadata && view.metadata.custom_fields;
    return fields && typeof fields === 'object' ? fields : {};
}

function customFieldValue(view, rule) {
    const section = customFields(view)[rule.section];
    if (!section || typeof section !== 'object') return '';
    const fields = array(rule.fields || rule.field).map(clean).filter(Boolean);
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(section, field)) {
            const value = clean(section[field]);
            if (value) return value;
        }
    }
    return '';
}

function supplierFor(view) {
    return clean(customFields(view)['Data Supplier'] &&
        customFields(view)['Data Supplier'].Organization);
}

function recordLicenseUrl(view) {
    const section = customFields(view)['License/Attribution'];
    if (!section || typeof section !== 'object') return '';
    return clean(section['License URL'] || section['License-URL']);
}

function normalizeUrl(value) {
    try {
        const url = new URL(value);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href.toLowerCase();
    } catch {
        return '';
    }
}

function normalizeEvidence(value, comparison) {
    if (comparison === 'url') return normalizeUrl(value);
    return clean(value).toLowerCase();
}

function validateRule(rule, kind) {
    const modes = kind === 'publisher' ? PUBLISHER_MODES : LICENSE_MODES;
    if (!rule || typeof rule !== 'object' || !modes.has(rule.mode)) {
        throw new Error('Socrata source has an invalid ' + kind + ' evidence mode');
    }
    const comparison = rule.comparison || 'text';
    if (!COMPARISONS.has(comparison) || (kind === 'publisher' && comparison !== 'text')) {
        throw new Error('Socrata source has an invalid ' + kind + ' comparison');
    }
    if (rule.mode === 'custom-field') {
        const fields = array(rule.fields || rule.field).map(clean).filter(Boolean);
        if (!clean(rule.section) || !fields.length) {
            throw new Error('Socrata source has an incomplete ' + kind + ' custom field');
        }
    }
    const allowed = array(rule.allowed).map(value => normalizeEvidence(value, comparison)).filter(Boolean);
    if (!allowed.length || allowed.length !== array(rule.allowed).length) {
        throw new Error('Socrata source has an invalid ' + kind + ' allowlist');
    }
    return { ...rule, comparison, allowed: new Set(allowed) };
}

function validateSource(source) {
    const required = [
        'id', 'homepageUrl', 'catalogUrl', 'upstreamHost', 'placeId',
        'defaultOrganizationId', 'defaultOrganizationName', 'defaultOrganizationTitleEn',
        'defaultLicenseTitleEn', 'defaultLicenseUrl', 'defaultAttributionEn'
    ];
    if (!source || source.kind !== 'socrata' || required.some(key => !clean(source[key]))) {
        throw new Error('Socrata source configuration is incomplete');
    }
    const policy = source.socrataPolicy;
    if (!policy || typeof policy !== 'object') {
        throw new Error('Socrata source admission policy is missing');
    }
    return {
        publisher: validateRule(policy.publisher, 'publisher'),
        license: validateRule(policy.license, 'license')
    };
}

function evidenceFor(view, rule) {
    if (rule.mode === 'custom-field') return customFieldValue(view, rule);
    if (rule.mode === 'attribution') return clean(view && view.attribution);
    if (rule.mode === 'view-license-name') return clean(view && view.license && view.license.name);
    return '';
}

function admissionFor(view, source) {
    const policy = validateSource(source);
    const publisher = evidenceFor(view, policy.publisher);
    const license = evidenceFor(view, policy.license);
    const normalizedPublisher = normalizeEvidence(publisher, policy.publisher.comparison);
    const normalizedLicense = normalizeEvidence(license, policy.license.comparison);
    return {
        publisher,
        license,
        publisherMode: policy.publisher.mode,
        licenseMode: policy.license.mode,
        publisherAdmitted: (!normalizedPublisher && policy.publisher.allowBlank === true) ||
            policy.publisher.allowed.has(normalizedPublisher),
        licenseAdmitted: Boolean(normalizedLicense) && policy.license.allowed.has(normalizedLicense)
    };
}

function licenseFor(view, source) {
    const admission = admissionFor(view, source);
    if (!admission.publisherAdmitted || !admission.licenseAdmitted) return null;
    return {
        titleEn: source.defaultLicenseTitleEn || null,
        titleFr: source.defaultLicenseTitleFr || null,
        url: source.defaultLicenseUrl,
        attributionEn: source.defaultAttributionEn || null,
        attributionFr: source.defaultAttributionFr || null
    };
}

function cachedRecordCount(view) {
    const counts = [];
    for (const column of array(view && view.columns)) {
        const cached = column && column.cachedContents;
        if (!cached || typeof cached !== 'object') continue;
        const direct = finiteNonNegative(cached.count);
        if (direct != null) counts.push(direct);
        const nonNull = finiteNonNegative(cached.non_null);
        const nulls = finiteNonNegative(cached.null);
        if (nonNull != null && nulls != null) counts.push(nonNull + nulls);
    }
    return counts.length ? Math.max(...counts) : null;
}

async function exactRecordCount(view, source, options = {}) {
    const cached = cachedRecordCount(view);
    if (cached != null) return cached;
    const fetchJson = options.fetchJson || fetchPublicJson;
    try {
        const payload = await fetchJson(countUrl(source, view.id), options.http);
        const count = finiteNonNegative(payload && payload[0] && payload[0].count);
        return count;
    } catch {
        return null;
    }
}

function geometryFields(view) {
    return array(view && view.columns).filter(column =>
        GEOMETRY_TYPES.has(clean(column && column.dataTypeName).toLowerCase()) &&
        clean(column && column.fieldName)
    ).map(column => ({
        name: clean(column.fieldName),
        alias: clean(column.name) || clean(column.fieldName),
        type: clean(column.dataTypeName).toLowerCase()
    }));
}

function directMapVersion(view, source, recordCount) {
    const fields = array(view && view.columns).map(column => ({
        name: clean(column && column.fieldName),
        type: clean(column && column.dataTypeName)
    }));
    const identity = [
        MAP_VERSION,
        source.id,
        clean(view && view.id),
        timestamp(view && view.viewLastModified),
        timestamp(view && view.rowsUpdatedAt),
        recordCount,
        fields,
        geoJsonBaseUrl(source, view && view.id)
    ];
    return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function discover(source, options = {}) {
    validateSource(source);
    const fetchJson = options.fetchJson || fetchPublicJson;
    const url = new URL(source.catalogUrl);
    url.searchParams.set('only', 'datasets');
    url.searchParams.set('search_context', source.upstreamHost);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', '0');
    const body = await fetchJson(url.href, options.http);
    const expectedTotal = Number(body && body.resultSetSize);
    const records = body && body.results;
    if (!Number.isInteger(expectedTotal) || expectedTotal < 0 || !Array.isArray(records)) {
        throw new Error('Socrata source returned an invalid catalogue response');
    }
    if (expectedTotal > PAGE_SIZE) {
        throw new Error('Socrata source catalogue exceeds the safe snapshot limit');
    }
    if (records.length !== expectedTotal) {
        throw new Error('Socrata source catalogue ended before its advertised count');
    }

    const identities = new Set();
    for (const record of records) {
        const identity = identityFor(record);
        if (!identity) throw new Error('Socrata source returned a record without a dataset id');
        const key = canonicalKey(identity);
        if (identities.has(key)) {
            throw new Error('Socrata source returned a duplicate dataset id: ' + identity);
        }
        identities.add(key);
    }

    if (!expectedTotal || records.length !== expectedTotal) {
        throw new Error('Socrata source returned an empty or incomplete catalogue');
    }
    return records;
}

async function enrichRecord(record, source, options = {}) {
    validateSource(source);
    const externalId = identityFor(record);
    const catalog = record && record.resource || {};
    if (!externalId || clean(catalog.type).toLowerCase() !== 'dataset' ||
        clean(catalog.lens_view_type).toLowerCase() !== 'tabular') {
        return { status: 'excluded', reason: 'invalid-dataset', externalId };
    }

    const fetchJson = options.fetchJson || fetchPublicJson;
    const view = await fetchJson(viewUrl(source, externalId), options.http);
    if (!view || canonicalKey(view.id) !== canonicalKey(externalId) ||
        !clean(view.name) || view.hideFromCatalog === true || view.hideFromDataJson === true) {
        return { status: 'excluded', reason: 'not-public', externalId: canonicalKey(externalId) };
    }

    const admission = admissionFor(view, source);
    if (!admission.publisherAdmitted) {
        return {
            status: 'excluded',
            reason: 'publisher-not-admitted',
            externalId: canonicalKey(externalId)
        };
    }
    if (!admission.licenseAdmitted) {
        return { status: 'excluded', reason: 'unlicensed', externalId: canonicalKey(externalId) };
    }
    const licence = licenseFor(view, source);

    const columns = array(view.columns).filter(column => clean(column && column.fieldName));
    if (!columns.length) {
        return { status: 'excluded', reason: 'not-loadable', externalId: canonicalKey(externalId) };
    }
    const recordCount = await exactRecordCount(view, source, options);
    const spatialFields = geometryFields(view);
    const maxMapRows = finiteNonNegative(process.env.MAP_MAX_ROWS) || 1_000_000;
    const hasMap = spatialFields.length > 0 && recordCount != null && recordCount <= maxMapRows;
    const datasetId = namespace(source.id, 'dataset', externalId);
    const resourceId = namespace(source.id, 'resource', externalId);
    const orgId = namespace(source.id, 'org', source.defaultOrganizationId);
    const modified = timestamp(view.viewLastModified || view.rowsUpdatedAt || catalog.updatedAt);
    const keywords = Array.from(new Set(array(view.tags).concat(array(catalog.domain_tags))
        .map(clean).filter(Boolean)));
    const title = clean(view.name || catalog.name);
    const rawIdentity = {
        provider: 'socrata',
        source_id: source.id,
        upstream_dataset_id: externalId
    };

    return {
        status: 'included',
        value: {
            externalId: canonicalKey(externalId),
            organization: {
                id: orgId,
                name: source.id + '-' + source.defaultOrganizationName,
                titleEn: source.defaultOrganizationTitleEn,
                titleFr: source.defaultOrganizationTitleFr || null,
                placeId: source.placeId
            },
            dataset: {
                id: datasetId,
                name: source.id + '-' + canonicalKey(externalId),
                titleEn: title,
                titleFr: null,
                notesEn: clean(view.description || catalog.description) || null,
                notesFr: null,
                orgId,
                keywordsEn: keywords,
                keywordsFr: [],
                metadataModified: modified,
                raw: { ...rawIdentity, metadata_language: source.metadataLanguage || 'en' }
            },
            source: {
                sourceId: source.id,
                externalId: canonicalKey(externalId),
                datasetId,
                landingUrl: source.homepageUrl.replace(/\/+$/, '') + '/d/' + encodeURIComponent(externalId),
                licenseTitleEn: licence.titleEn,
                licenseTitleFr: licence.titleFr,
                licenseUrl: licence.url,
                attributionEn: licence.attributionEn,
                attributionFr: licence.attributionFr,
                isAuthoritative: true,
                raw: {
                    upstream_dataset_id: externalId,
                    publisher_evidence: admission.publisher || null,
                    publisher_evidence_mode: admission.publisherMode,
                    license_evidence: admission.license || null,
                    license_evidence_mode: admission.licenseMode,
                    data_supplier: supplierFor(view) || null,
                    license_url: recordLicenseUrl(view) || null,
                    rows_updated_at: timestamp(view.rowsUpdatedAt),
                    view_last_modified: timestamp(view.viewLastModified)
                }
            },
            resources: [{
                id: resourceId,
                datasetId,
                nameEn: title,
                nameFr: null,
                format: 'CSV',
                url: csvUrl(source, externalId),
                sizeBytes: null,
                datastoreActive: false,
                language: 'en',
                lastModified: modified,
                raw: {
                    ...rawIdentity,
                    original_format: 'CSV',
                    record_count: recordCount,
                    field_count: columns.length,
                    rows_updated_at: timestamp(view.rowsUpdatedAt),
                    view_last_modified: timestamp(view.viewLastModified),
                    geometry_fields: spatialFields
                }
            }],
            places: [{
                datasetId,
                placeId: source.placeId,
                relationship: 'direct',
                includesDescendants: false,
                assignmentMethod: 'source'
            }],
            maps: [],
            manageMaps: false,
            manageMapCandidates: true,
            mapCandidates: hasMap ? [{
                resourceId,
                desiredVersion: directMapVersion(view, source, recordCount),
                mode: 'socrata-geojson-pmtiles',
                sourceUrl: geoJsonBaseUrl(source, externalId),
                expectedRows: recordCount,
                expectedVertices: null,
                expectedBytes: null,
                raw: {
                    ...rawIdentity,
                    geometry_fields: spatialFields,
                    rows_updated_at: timestamp(view.rowsUpdatedAt),
                    view_last_modified: timestamp(view.viewLastModified)
                }
            }] : []
        }
    };
}

module.exports = {
    PAGE_SIZE,
    MAP_VERSION,
    discover,
    enrichRecord,
    identityFor,
    canonicalKey,
    namespace,
    viewUrl,
    countUrl,
    csvUrl,
    geoJsonBaseUrl,
    geoJsonPageUrl,
    admissionFor,
    validateSource,
    licenseFor,
    cachedRecordCount,
    exactRecordCount,
    geometryFields,
    directMapVersion,
    timestamp
};
