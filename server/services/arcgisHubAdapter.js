const { fetchPublicJson } = require('./publicJson');

const ITEM_RE = /[?&]id=([0-9a-f]{32})(?:&|$)/i;
const LAYER_RE = /[?&](?:sublayer|layers)=([0-9]+)(?:&|$)/i;
const GEO_TYPES = {
    esriGeometryPoint: 'point',
    esriGeometryMultipoint: 'multipoint',
    esriGeometryPolyline: 'polyline',
    esriGeometryPolygon: 'polygon'
};

function collapse(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isPlaceholder(value) {
    const text = collapse(value);
    return !text || /^\{\{[^}]+\}\}$/.test(text) || /^\$\{[^}]+\}$/.test(text);
}

function timestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = typeof value === 'number' || /^\d{11,}$/.test(String(value))
        ? Number(value)
        : null;
    const date = new Date(numeric == null ? value : numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeEntities(value) {
    return value
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
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

function array(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
}

function distribution(record, format) {
    return array(record.distribution).find(item => collapse(item && item.format).toLowerCase() === format.toLowerCase()) || null;
}

function namespaceFor(record) {
    const landing = collapse(record.landingPage);
    const match = landing.match(/\/datasets\/([^/:]+)::/i);
    return match ? match[1].toLowerCase() : null;
}

function identityFor(record) {
    const identifier = collapse(record.identifier);
    const itemMatch = identifier.match(ITEM_RE);
    if (!itemMatch) return null;
    const layerMatch = identifier.match(LAYER_RE);
    return { itemId: itemMatch[1].toLowerCase(), layerId: layerMatch ? Number(layerMatch[1]) : null };
}

function canonicalKey(identity) {
    return identity.itemId + ':' + (identity.layerId == null ? 'item' : identity.layerId);
}

function idsFor(identity) {
    const suffix = identity.layerId == null ? 'item' : String(identity.layerId);
    return {
        datasetId: 'arcgis-' + identity.itemId + '-' + suffix,
        resourceId: 'arcgis-' + identity.itemId + '-' + suffix + '-data'
    };
}

function parseSpatial(value) {
    const parts = String(value || '').split(',').map(Number);
    if (parts.length !== 4 || parts.some(number => !Number.isFinite(number))) return null;
    const [west, south, east, north] = parts;
    if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
    return [west, south, east, north];
}

function mercatorToLonLat(x, y) {
    const longitude = x / 20037508.34 * 180;
    const latitude = Math.atan(Math.exp(y / 20037508.34 * Math.PI)) * 360 / Math.PI - 90;
    return [Math.max(-180, Math.min(180, longitude)), Math.max(-90, Math.min(90, latitude))];
}

function extentFrom(metadata, record) {
    const spatial = parseSpatial(record && record.spatial);
    if (spatial) return spatial;
    const extent = metadata && metadata.extent;
    if (!extent) return null;
    const wkid = extent.spatialReference && (extent.spatialReference.latestWkid || extent.spatialReference.wkid);
    if (wkid === 4326 && [extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)) {
        return parseSpatial([extent.xmin, extent.ymin, extent.xmax, extent.ymax].join(','));
    }
    if ((wkid === 3857 || wkid === 102100) && [extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)) {
        const [west, south] = mercatorToLonLat(extent.xmin, extent.ymin);
        const [east, north] = mercatorToLonLat(extent.xmax, extent.ymax);
        return parseSpatial([west, south, east, north].join(','));
    }
    return null;
}

function matchRule(rules, namespace, publisher) {
    for (const rule of rules || []) {
        const namespaceMatches = !rule.namespace || rule.namespace === namespace;
        const publisherMatches = !rule.publisher || (
            rule.publisher instanceof RegExp ? rule.publisher.test(publisher) : rule.publisher === publisher
        );
        if (namespaceMatches && publisherMatches) return rule;
    }
    return null;
}

function canonicalPublisher(source, suppliedPublisher) {
    for (const alias of source.publisherAliases || []) {
        if (alias.publisher.test(suppliedPublisher)) {
            return alias.name;
        }
    }
    return isPlaceholder(suppliedPublisher) ? source.nameEn : suppliedPublisher;
}

function authoritativePublisher(source, publisher) {
    return (source.authoritativePublishers || []).some(entry => entry.publisher.test(publisher));
}

function publisherName(record, item, source) {
    const supplied = collapse(record.publisher && record.publisher.name);
    if (supplied && !isPlaceholder(supplied)) return canonicalPublisher(source, supplied);
    const owner = collapse(item && (item.owner || item.ownerUser));
    if (owner) return canonicalPublisher(source, owner);
    return source.nameEn;
}

function knownLicense(raw) {
    const text = collapse(raw).toLowerCase();
    if (text.includes('open.canada.ca/en/open-government-licence-canada') || text.includes('licence du gouvernement ouvert – canada')) {
        return {
            titleEn: 'Open Government Licence – Canada',
            titleFr: 'Licence du gouvernement ouvert – Canada',
            url: 'https://open.canada.ca/en/open-government-licence-canada'
        };
    }
    if (text.includes('statcan.gc.ca/en/reference/licence') || text.includes('statistique canada') || text.includes('statistics canada open licence')) {
        return {
            titleEn: 'Statistics Canada Open Licence',
            titleFr: 'Licence ouverte de Statistique Canada',
            url: 'https://www.statcan.gc.ca/en/reference/licence'
        };
    }
    if (text.includes('creativecommons.org/licenses/by/4.0') || text.includes('cc by 4.0') || text.includes('creative commons attribution 4.0')) {
        return {
            titleEn: 'Creative Commons Attribution 4.0 International',
            titleFr: 'Creative Commons Attribution 4.0 International',
            url: 'https://creativecommons.org/licenses/by/4.0/'
        };
    }
    return null;
}

function resolveLicense(candidates, source, namespace, publisher) {
    const candidateTexts = candidates.map(collapse).filter(Boolean);
    const restricted = candidateTexts.some(text => (source.restrictedLicensePatterns || []).some(re => re.test(text)));
    if (restricted) return { status: 'restricted-license', license: null };
    for (const text of candidateTexts) {
        const direct = knownLicense(text);
        if (direct) return { status: 'known', license: direct };
    }
    const rule = matchRule(source.licenseRules, namespace, publisher);
    if (rule) return { status: 'source-rule', license: rule.license };
    return { status: 'unlicensed', license: null };
}

function slugKey(value) {
    return collapse(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function selectedFields(metadata) {
    const fields = Array.isArray(metadata && metadata.fields) ? metadata.fields : [];
    const wanted = [];
    const add = name => {
        const clean = collapse(name);
        if (!clean || wanted.includes(clean)) return;
        wanted.push(clean);
    };
    add(metadata && metadata.objectIdField);
    add(metadata && metadata.displayField);
    for (const field of fields) {
        if (wanted.length >= 20) break;
        add(field.name);
    }
    return wanted;
}

function serviceIsLeaf(metadata) {
    const type = collapse(metadata && metadata.type).toLowerCase();
    if (type.includes('group layer') || type.includes('annotation')) return false;
    return Boolean(GEO_TYPES[metadata && metadata.geometryType]) || type === 'table';
}

function formatForDirectItem(record, item) {
    const formats = array(record.distribution).map(entry => collapse(entry && entry.format).toUpperCase());
    if (formats.includes('XLSX') || /excel/i.test(item && item.type)) return 'XLSX';
    if (formats.includes('CSV') || /^csv$/i.test(item && item.type)) return 'CSV';
    if (/\.xlsx(?:$|\?)/i.test(item && item.url)) return 'XLSX';
    if (/\.csv(?:$|\?)/i.test(item && item.url)) return 'CSV';
    return null;
}

function directUrl(identity, format, item, record) {
    if (format === 'CSV' && /^csv$/i.test(item && item.type)) {
        return 'https://www.arcgis.com/sharing/rest/content/items/' + identity.itemId + '/data';
    }
    const dist = distribution(record, format);
    return collapse(dist && (dist.downloadURL || dist.accessURL)) || collapse(item && item.url) || null;
}

async function enrichRecord(record, source, options = {}) {
    const identity = identityFor(record);
    if (!identity) return { status: 'excluded', reason: 'missing-item-id', externalId: null };
    const itemUrl = 'https://www.arcgis.com/sharing/rest/content/items/' + identity.itemId + '?f=json';
    let item;
    try {
        item = await (options.fetchJson || fetchPublicJson)(itemUrl, options.http);
    } catch {
        return { status: 'excluded', reason: 'item-metadata-failed', externalId: canonicalKey(identity) };
    }
    const namespace = namespaceFor(record);
    const suppliedPublisher = collapse(record.publisher && record.publisher.name);
    const publisher = publisherName(record, item, source);
    const licenseResult = resolveLicense(
        [record.license, record.rights, item.licenseInfo].filter(value => value != null),
        source,
        namespace,
        publisher
    );
    if (!licenseResult.license || !licenseResult.license.url) {
        return { status: 'excluded', reason: licenseResult.status, externalId: canonicalKey(identity) };
    }
    const licence = licenseResult.license;
    const geo = distribution(record, 'ArcGIS GeoServices REST API');
    const serviceUrl = collapse(geo && geo.accessURL);
    let metadata = null;
    if (serviceUrl && identity.layerId != null) {
        try {
            metadata = await (options.fetchJson || fetchPublicJson)(serviceUrl + (serviceUrl.includes('?') ? '&' : '?') + 'f=json', options.http);
        } catch {
            return { status: 'excluded', reason: 'layer-metadata-failed', externalId: canonicalKey(identity) };
        }
        if (!serviceIsLeaf(metadata)) return { status: 'excluded', reason: 'non-leaf-layer', externalId: canonicalKey(identity) };
    }

    let format = serviceUrl ? 'CSV' : formatForDirectItem(record, item);
    if (!format) return { status: 'excluded', reason: 'not-loadable', externalId: canonicalKey(identity) };
    if (format === 'XLSX' && Number(item.size) > 20 * 1024 * 1024) {
        return { status: 'excluded', reason: 'xlsx-too-large', externalId: canonicalKey(identity) };
    }

    const placeRule = matchRule(source.placeRules, namespace, publisher);
    const ids = idsFor(identity);
    const rawTitle = record.title || (metadata && metadata.name) || item.title || ids.datasetId;
    const title = collapse(htmlToText(rawTitle)) || ids.datasetId;
    const description = htmlToText(record.description || item.description || item.snippet || '');
    const keywords = Array.from(new Set(array(record.keyword).concat(array(item.tags)).map(collapse).filter(Boolean)));
    const orgId = 'arcgis-publisher-' + (slugKey(publisher) || 'government-publisher');
    const geometryType = GEO_TYPES[metadata && metadata.geometryType] || null;
    const resourceUrl = serviceUrl
        ? 'https://hub.arcgis.com/api/download/v1/items/' + identity.itemId + '/csv?layers=' + identity.layerId
        : directUrl(identity, format, item, record);
    if (!resourceUrl) return { status: 'excluded', reason: 'missing-download', externalId: canonicalKey(identity) };

    const normalized = {
        externalId: canonicalKey(identity),
        organization: {
            id: orgId,
            name: orgId,
            titleEn: publisher,
            titleFr: null,
            placeId: placeRule ? placeRule.placeId : null
        },
        dataset: {
            id: ids.datasetId,
            name: ids.datasetId,
            titleEn: title,
            titleFr: null,
            notesEn: description || null,
            notesFr: null,
            orgId,
            keywordsEn: keywords,
            keywordsFr: [],
            metadataModified: timestamp(record.modified || item.modified),
            raw: { provider: 'arcgis', item_id: identity.itemId, layer_id: identity.layerId }
        },
        source: {
            sourceId: source.id,
            externalId: canonicalKey(identity),
            datasetId: ids.datasetId,
            landingUrl: collapse(record.landingPage) || collapse(record.identifier),
            licenseTitleEn: licence.titleEn,
            licenseTitleFr: licence.titleFr || null,
            licenseUrl: licence.url,
            attributionEn: licence.attributionEn || null,
            attributionFr: licence.attributionFr || null,
            isAuthoritative: authoritativePublisher(source, publisher),
            raw: {
                identifier: record.identifier,
                namespace,
                publisher,
                supplied_publisher: isPlaceholder(suppliedPublisher) ? null : suppliedPublisher
            }
        },
        resource: {
            id: ids.resourceId,
            datasetId: ids.datasetId,
            nameEn: title,
            nameFr: null,
            format,
            url: resourceUrl,
            sizeBytes: serviceUrl ? null : (Number.isFinite(Number(item.size)) ? Number(item.size) : null),
            datastoreActive: false,
            language: 'en',
            lastModified: timestamp(record.modified || item.modified),
            raw: { provider: 'arcgis', item_id: identity.itemId, layer_id: identity.layerId }
        },
        places: placeRule ? [{
            datasetId: ids.datasetId,
            placeId: placeRule.placeId,
            relationship: placeRule.relationship,
            includesDescendants: placeRule.includesDescendants,
            assignmentMethod: 'source'
        }] : [],
        map: geometryType ? {
            resourceId: ids.resourceId,
            serviceUrl,
            geometryType,
            extent: extentFrom(metadata, record),
            objectIdField: metadata.objectIdField || null,
            displayField: metadata.displayField || null,
            fields: selectedFields(metadata),
            maxRecordCount: Number(metadata.maxRecordCount) || null
        } : null
    };
    return { status: 'included', value: normalized };
}

async function discover(source, options = {}) {
    const feed = await (options.fetchJson || fetchPublicJson)(source.catalogUrl, options.http);
    if (!feed || !Array.isArray(feed.dataset) || feed.dataset.length === 0) {
        throw new Error('ArcGIS Hub returned an empty or invalid DCAT feed');
    }
    return feed.dataset;
}

module.exports = {
    discover,
    enrichRecord,
    identityFor,
    canonicalKey,
    htmlToText,
    parseSpatial,
    extentFrom,
    selectedFields,
    serviceIsLeaf,
    knownLicense,
    resolveLicense,
    publisherName,
    canonicalPublisher,
    authoritativePublisher,
    isPlaceholder,
    timestamp
};
