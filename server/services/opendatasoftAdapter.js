const crypto = require('node:crypto');
const { fetchPublicJson } = require('./publicJson');

const PAGE_SIZE = 100;
const DIRECT_GEOJSON_VERSION = 'opendatasoft-geojson-v1';

function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function array(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
}

function timestamp(value) {
    if (value == null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeEntities(value) {
    return value
        .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
        .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function htmlToText(value) {
    const text = String(value == null ? '' : value)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function patternMatches(pattern, value) {
    if (!pattern) return true;
    if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
        return pattern.test(clean(value));
    }
    return clean(pattern).toLowerCase() === clean(value).toLowerCase();
}

function finiteNonNegative(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function namespace(sourceId, kind, upstreamId) {
    return ['opendatasoft', sourceId, kind, clean(upstreamId).toLowerCase()].join('-');
}

function identityFor(record) {
    return clean(record && record.dataset_id) || null;
}

function canonicalKey(identity) {
    return clean(identity).toLowerCase();
}

function metadataFor(record) {
    const metas = record && record.metas;
    return metas && typeof metas.default === 'object' && metas.default ? metas.default : {};
}

function publisherName(record, source) {
    const metadata = metadataFor(record);
    return clean(metadata.publisher) || clean(source.defaultOrganizationTitleEn) ||
        clean(source.nameEn) || 'Publisher';
}

function authoritativePublisher(source, publisher) {
    if (!Array.isArray(source.authoritativePublishers)) return true;
    return source.authoritativePublishers.some(rule => patternMatches(rule.publisher, publisher));
}

function placeRuleFor(source, publisher) {
    const rules = Array.isArray(source.placeRules) ? source.placeRules : [];
    const matched = rules.find(rule => patternMatches(rule.publisher, publisher));
    if (matched) return matched;
    if (!source.placeId) return null;
    return {
        placeId: source.placeId,
        relationship: 'direct',
        includesDescendants: false
    };
}

function configuredLicense(source) {
    if (!source.defaultLicenseUrl) return null;
    return {
        titleEn: source.defaultLicenseTitleEn || null,
        titleFr: source.defaultLicenseTitleFr || null,
        url: source.defaultLicenseUrl,
        attributionEn: source.defaultAttributionEn || null,
        attributionFr: source.defaultAttributionFr || null
    };
}

function licenseFor(record, source, publisher = publisherName(record, source)) {
    const metadata = metadataFor(record);
    const rules = Array.isArray(source.licenseRules) ? source.licenseRules : [];
    if (rules.length) {
        const matched = rules.find(rule =>
            patternMatches(rule.publisher, publisher) &&
            patternMatches(rule.licenseTitle, metadata.license) &&
            patternMatches(rule.licenseUrl, metadata.license_url)
        );
        return matched ? matched.license : null;
    }
    return source.licenseMode === 'record-explicit' ? null : configuredLicense(source);
}

function exportUrl(source, datasetId, format) {
    const normalizedFormat = clean(format).toLowerCase();
    if (!['csv', 'geojson'].includes(normalizedFormat)) {
        throw new Error('unsupported Opendatasoft export format: ' + format);
    }
    const url = new URL(
        source.catalogUrl.replace(/\/+$/, '') + '/catalog/datasets/' +
        encodeURIComponent(clean(datasetId)) + '/exports/' + normalizedFormat
    );
    url.searchParams.set('lang', source.metadataLanguage === 'fr' ? 'fr' : 'en');
    url.searchParams.set('timezone', source.timezone || 'UTC');
    if (normalizedFormat === 'csv') {
        url.searchParams.set('use_labels', 'false');
        url.searchParams.set('delimiter', ',');
    }
    return url.href;
}

function directMapVersion(record, source) {
    const metadata = metadataFor(record);
    const fields = array(record && record.fields).map(field => ({
        name: clean(field && field.name),
        type: clean(field && field.type)
    }));
    const identity = [
        DIRECT_GEOJSON_VERSION,
        source.id,
        identityFor(record),
        clean(record && record.dataset_uid) || null,
        timestamp(metadata.data_processed || metadata.modified),
        finiteNonNegative(metadata.records_count),
        fields,
        array(metadata.geometry_types).map(clean),
        exportUrl(source, identityFor(record), 'geojson')
    ];
    return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function discover(source, options = {}) {
    const fetchJson = options.fetchJson || fetchPublicJson;
    const records = [];
    const identities = new Set();
    let expectedTotal = null;

    for (let offset = 0; expectedTotal == null || offset < expectedTotal; offset += PAGE_SIZE) {
        const url = new URL(source.catalogUrl.replace(/\/+$/, '') + '/catalog/datasets');
        url.searchParams.set('limit', String(PAGE_SIZE));
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('order_by', 'dataset_id');
        const body = await fetchJson(url.href, options.http);
        const total = Number(body && body.total_count);
        const page = body && body.results;
        if (!Number.isInteger(total) || total < 0 || !Array.isArray(page)) {
            throw new Error('Opendatasoft source returned an invalid catalogue response');
        }
        if (expectedTotal == null) expectedTotal = total;
        if (total !== expectedTotal) {
            throw new Error('Opendatasoft source catalogue count changed during pagination');
        }
        const expectedPageSize = Math.min(PAGE_SIZE, expectedTotal - offset);
        if (page.length !== expectedPageSize) {
            throw new Error('Opendatasoft source catalogue ended before its advertised count');
        }
        for (const record of page) {
            const identity = identityFor(record);
            if (!identity) throw new Error('Opendatasoft source returned a record without a dataset id');
            const key = canonicalKey(identity);
            if (identities.has(key)) {
                throw new Error('Opendatasoft source returned a duplicate dataset id: ' + identity);
            }
            identities.add(key);
            records.push(record);
        }
    }

    if (expectedTotal === 0 || records.length === 0) {
        throw new Error('Opendatasoft source returned an empty catalogue');
    }
    if (records.length !== expectedTotal) {
        throw new Error('Opendatasoft source catalogue count did not match its records');
    }
    return records;
}

async function enrichRecord(record, source) {
    const externalId = identityFor(record);
    const metadata = metadataFor(record);
    const fields = array(record && record.fields).filter(field => clean(field && field.name));
    if (!externalId || !clean(metadata.title)) {
        return { status: 'excluded', reason: 'invalid-dataset', externalId };
    }
    if (record.visibility !== 'domain' || record.data_visible !== true) {
        return { status: 'excluded', reason: 'not-public', externalId: canonicalKey(externalId) };
    }
    if (record.has_records !== true || fields.length === 0) {
        return { status: 'excluded', reason: 'not-loadable', externalId: canonicalKey(externalId) };
    }

    const publisher = publisherName(record, source);
    if (!authoritativePublisher(source, publisher)) {
        return { status: 'excluded', reason: 'publisher-not-admitted', externalId: canonicalKey(externalId) };
    }
    const licence = licenseFor(record, source, publisher);
    if (!licence || !licence.url) {
        return { status: 'excluded', reason: 'unlicensed', externalId: canonicalKey(externalId) };
    }

    const datasetId = namespace(source.id, 'dataset', externalId);
    const resourceId = namespace(source.id, 'resource', externalId);
    const upstreamOrgId = source.defaultOrganizationId || 'publisher';
    const orgId = namespace(source.id, 'org', upstreamOrgId);
    const placeRule = placeRuleFor(source, publisher);
    const keywords = Array.from(new Set(
        array(metadata.theme).concat(array(metadata.keyword)).map(clean).filter(Boolean)
    ));
    const modified = timestamp(metadata.data_processed || metadata.modified);
    const recordCount = finiteNonNegative(metadata.records_count);
    const geometryTypes = array(metadata.geometry_types).map(clean).filter(Boolean);
    const hasMap = array(record.features).map(clean).includes('geo') && geometryTypes.length > 0;
    const csvUrl = exportUrl(source, externalId, 'csv');
    const geoJsonUrl = hasMap ? exportUrl(source, externalId, 'geojson') : null;

    return {
        status: 'included',
        value: {
            externalId: canonicalKey(externalId),
            organization: {
                id: orgId,
                name: source.id + '-' + (source.defaultOrganizationName || upstreamOrgId),
                titleEn: source.defaultOrganizationTitleEn || publisher,
                titleFr: source.defaultOrganizationTitleFr || null,
                placeId: placeRule ? placeRule.placeId : null
            },
            dataset: {
                id: datasetId,
                name: source.id + '-' + canonicalKey(externalId),
                titleEn: clean(metadata.title),
                titleFr: null,
                notesEn: htmlToText(metadata.description) || null,
                notesFr: null,
                orgId,
                keywordsEn: keywords,
                keywordsFr: [],
                metadataModified: modified,
                raw: {
                    provider: 'opendatasoft',
                    source_id: source.id,
                    upstream_dataset_id: externalId,
                    dataset_uid: clean(record.dataset_uid) || null,
                    metadata_language: 'en'
                }
            },
            source: {
                sourceId: source.id,
                externalId: canonicalKey(externalId),
                datasetId,
                landingUrl: source.homepageUrl.replace(/\/+$/, '') + '/explore/dataset/' +
                    encodeURIComponent(externalId) + '/information/',
                licenseTitleEn: licence.titleEn || null,
                licenseTitleFr: licence.titleFr || null,
                licenseUrl: licence.url,
                attributionEn: licence.attributionEn || null,
                attributionFr: licence.attributionFr || null,
                isAuthoritative: true,
                raw: {
                    upstream_dataset_id: externalId,
                    dataset_uid: clean(record.dataset_uid) || null,
                    publisher,
                    supplied_publisher: clean(metadata.publisher) || null,
                    license_title: clean(metadata.license) || null,
                    license_url: clean(metadata.license_url) || null
                }
            },
            resources: [{
                id: resourceId,
                datasetId,
                nameEn: clean(metadata.title),
                nameFr: null,
                format: 'CSV',
                url: csvUrl,
                sizeBytes: null,
                datastoreActive: false,
                language: 'en',
                lastModified: modified,
                raw: {
                    provider: 'opendatasoft',
                    source_id: source.id,
                    upstream_dataset_id: externalId,
                    dataset_uid: clean(record.dataset_uid) || null,
                    original_format: 'CSV',
                    record_count: recordCount,
                    field_count: fields.length,
                    data_processed: timestamp(metadata.data_processed)
                }
            }],
            places: placeRule ? [{
                datasetId,
                placeId: placeRule.placeId,
                relationship: placeRule.relationship,
                includesDescendants: placeRule.includesDescendants === true,
                assignmentMethod: 'source'
            }] : [],
            maps: [],
            manageMaps: false,
            manageMapCandidates: true,
            mapCandidates: hasMap ? [{
                resourceId,
                desiredVersion: directMapVersion(record, source),
                mode: 'geojson-file',
                sourceUrl: geoJsonUrl,
                expectedRows: recordCount,
                expectedVertices: null,
                expectedBytes: null,
                raw: {
                    provider: 'opendatasoft',
                    source_id: source.id,
                    upstream_dataset_id: externalId,
                    dataset_uid: clean(record.dataset_uid) || null
                }
            }] : []
        }
    };
}

module.exports = {
    PAGE_SIZE,
    discover,
    enrichRecord,
    identityFor,
    canonicalKey,
    namespace,
    exportUrl,
    directMapVersion,
    licenseFor,
    authoritativePublisher,
    placeRuleFor,
    htmlToText
};
