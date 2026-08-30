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
    const dcat = parseSpatial(record.spatial);
    if (dcat) return dcat;
    const extent = metadata && metadata.extent;
    if (!extent) return null;
    const values = [extent.xmin, extent.ymin, extent.xmax, extent.ymax].map(Number);
    if (values.some(number => !Number.isFinite(number))) return null;
    const wkid = Number(extent.spatialReference && (extent.spatialReference.latestWkid || extent.spatialReference.wkid));
    if (wkid === 4326) return values;
    if ([3857, 102100, 102113].includes(wkid)) {
        const sw = mercatorToLonLat(values[0], values[1]);
        const ne = mercatorToLonLat(values[2], values[3]);
        return [sw[0], sw[1], ne[0], ne[1]];
    }
    return null;
}

function patternMatches(pattern, value) {
    if (!pattern) return true;
    if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
        return pattern.test(value);
    }
    return String(value).toLowerCase().includes(String(pattern).toLowerCase());
}

function canonicalPublisher(value, source) {
    const publisher = collapse(value) || 'Government publisher';
    const alias = (source.publisherAliases || []).find(rule => patternMatches(rule.publisher, publisher));
    return alias ? alias.name : publisher;
}

function configuredPlaceholderPublisher(source) {
    const configured = collapse(source && source.placeholderPublisher);
    const expectedHost = collapse(source && source.upstreamHost).toLowerCase();
    if (!configured || !expectedHost) return null;
    try {
        const catalog = new URL(source.catalogUrl);
        if (catalog.protocol !== 'https:' || catalog.hostname.toLowerCase() !== expectedHost) return null;
        return configured;
    } catch {
        return null;
    }
}

function publisherName(record, item, source) {
    const supplied = collapse(record.publisher && record.publisher.name);
    const fallback = collapse(item && item.owner) || collapse(item && item.orgId);
    const placeholder = isPlaceholder(supplied) ? configuredPlaceholderPublisher(source) : null;
    return canonicalPublisher(isPlaceholder(supplied) ? (placeholder || fallback) : supplied, source);
}

function ruleMatches(rule, namespace, publisher, licenseEvidence = '') {
    if (rule.namespace && rule.namespace !== namespace) return false;
    if (rule.publisher && !patternMatches(rule.publisher, publisher)) return false;
    if (rule.licensePattern && !patternMatches(rule.licensePattern, licenseEvidence)) return false;
    return true;
}

function matchRule(rules, namespace, publisher, licenseEvidence = '') {
    return (rules || []).find(rule => ruleMatches(rule, namespace, publisher, licenseEvidence)) || null;
}

function resolveLicense(value, source, namespace, publisher) {
    const evidence = array(value).map(entry => collapse(entry) + ' ' + htmlToText(entry)).join(' ').trim();
    if ((source.restrictedLicensePatterns || []).some(pattern => patternMatches(pattern, evidence))) {
        return { status: 'restricted-license', license: null };
    }
    const rule = matchRule(source.licenseRules, namespace, publisher, evidence);
    if (rule) return { status: 'recognized', license: rule.license };
    if (source.licenseMode !== 'record-explicit') {
        const raw = collapse(htmlToText(value));
        if (source.allowUnrecognizedLicenseUrl && /^https?:\/\//i.test(raw)) {
            return {
                status: 'recognized',
                license: { titleEn: 'Licence supplied by the publisher', titleFr: 'Licence fournie par l’éditeur', url: raw }
            };
        }
    }
    return { status: 'unlicensed', license: null };
}

function knownLicense(value, source, namespace, publisher) {
    return resolveLicense(value, source, namespace, publisher).license;
}

function authoritativePublisher(source, publisher) {
    if (!Array.isArray(source.authoritativePublishers)) return true;
    return source.authoritativePublishers.some(rule => patternMatches(rule.publisher, publisher));
}

function slugKey(value) {
    return collapse(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function selectedFields(metadata) {
    const fields = array(metadata && metadata.fields)
        .filter(field => field && field.name && !/geometry|blob|raster/i.test(field.type || ''))
        .filter(field => !/^shape(__)?(area|length)$/i.test(field.name))
        .map(field => ({ name: field.name, alias: collapse(field.alias) || field.name, type: field.type || 'text' }));
    const wanted = [];
    const add = (name) => {
        const field = fields.find(candidate => candidate.name === name);
        if (field && !wanted.some(candidate => candidate.name === field.name)) wanted.push(field);
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
    if (!identity) return { status: 'excluded', reason: 'missing-item-id' };
    const itemUrl = 'https://www.arcgis.com/sharing/rest/content/items/' + identity.itemId + '?f=json';
    const item = await (options.fetchJson || fetchPublicJson)(itemUrl, options.http);
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
    if (serviceUrl && (source.unavailableServicePatterns || []).some(pattern => patternMatches(pattern, serviceUrl))) {
        return { status: 'excluded', reason: 'unavailable-service', externalId: canonicalKey(identity) };
    }
    let metadata = null;
    if (serviceUrl && identity.layerId != null) {
        metadata = await (options.fetchJson || fetchPublicJson)(serviceUrl + (serviceUrl.includes('?') ? '&' : '?') + 'f=json', options.http);
        if (!serviceIsLeaf(metadata)) return { status: 'excluded', reason: 'non-leaf-layer', externalId: canonicalKey(identity) };
    }

    let format = serviceUrl ? 'CSV' : formatForDirectItem(record, item);
    if (!format) return { status: 'excluded', reason: 'not-loadable', externalId: canonicalKey(identity) };
    if (format === 'XLSX' && Number(item.size) > 20 * 1024 * 1024) {
        return { status: 'excluded', reason: 'xlsx-too-large', externalId: canonicalKey(identity) };
    }

    const placeRule = matchRule(source.placeRules, namespace, publisher);
    const ids = idsFor(identity);
    const title = collapse(record.title) || collapse(metadata && metadata.name) || collapse(item.title) || ids.datasetId;
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
    configuredPlaceholderPublisher,
    isPlaceholder,
    timestamp
};
