const { fetchPublicJson } = require('../utils/fetch');
const { htmlToText } = require('../utils/text');

const PLACEHOLDER_PUBLISHER_RE = /^(?:city|town|region|county|district|municipality|government|null|undefined|{{source}})$/i;
const GEO_TYPES = {
    esriGeometryPoint: 'point',
    esriGeometryMultipoint: 'multipoint',
    esriGeometryPolyline: 'linestring',
    esriGeometryPolygon: 'polygon'
};

function collapse(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ');
}

function slugKey(value) {
    return collapse(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function array(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function isPlaceholder(value) {
    const text = collapse(value);
    if (!text) return true;
    return PLACEHOLDER_PUBLISHER_RE.test(text);
}

function parseLayerId(url) {
    if (!url) return null;
    const match = url.match(/(?:FeatureServer|MapServer)\/(\d+)(?:\/|\?|$)/i);
    return match ? parseInt(match[1], 10) : null;
}

function parseSpatial(spatial) {
    if (!spatial) return null;
    const text = collapse(spatial);
    const coords = text.split(/[,\s]+/).map(Number);
    if (coords.length === 4 && coords.every(n => Number.isFinite(n))) {
        return coords;
    }
    return null;
}

function extentFrom(layerMetadata, record) {
    if (layerMetadata && layerMetadata.extent) {
        const { xmin, ymin, xmax, ymax, spatialReference } = layerMetadata.extent;
        if (
            Number.isFinite(xmin) && Number.isFinite(ymin) &&
            Number.isFinite(xmax) && Number.isFinite(ymax) &&
            (!spatialReference || spatialReference.wkid === 4326 || spatialReference.latestWkid === 4326)
        ) {
            return [xmin, ymin, xmax, ymax];
        }
    }
    return parseSpatial(record && record.spatial);
}

function selectedFields(layerMetadata) {
    if (!layerMetadata || !Array.isArray(layerMetadata.fields)) return [];
    return layerMetadata.fields
        .filter(f => f && f.name && !['esriFieldTypeGeometry', 'esriFieldTypeBlob', 'esriFieldTypeRaster'].includes(f.type))
        .map(f => ({
            name: f.name,
            alias: f.alias || f.name,
            type: f.type || 'esriFieldTypeString'
        }));
}

function serviceIsLeaf(layerMetadata) {
    if (!layerMetadata) return true;
    if (layerMetadata.type === 'Feature Layer' || layerMetadata.type === 'Table') return true;
    if (Array.isArray(layerMetadata.layers) && layerMetadata.layers.length > 0) return false;
    return true;
}

function parseItemId(url) {
    if (!url) return null;
    const match = url.match(/[?&]id=([0-9a-fA-F]{32})/);
    return match ? match[1] : null;
}

function identityFor(record) {
    const directId = record && record.identifier && collapse(record.identifier);
    const landingPage = collapse(record && record.landingPage);
    const distributions = array(record && record.distribution);
    const distUrls = distributions.map(d => collapse(d && (d.accessURL || d.downloadURL)));
    const allUrls = [landingPage, ...distUrls].filter(Boolean);

    let itemId = null;
    if (directId && /^[0-9a-fA-F]{32}$/.test(directId)) {
        itemId = directId;
    }
    if (!itemId) {
        for (const url of allUrls) {
            itemId = parseItemId(url);
            if (itemId) break;
        }
    }
    if (!itemId) {
        for (const url of allUrls) {
            const match = url.match(/\/items\/([0-9a-fA-F]{32})/);
            if (match) {
                itemId = match[1];
                break;
            }
        }
    }
    if (!itemId) return null;

    let layerId = null;
    for (const url of allUrls) {
        layerId = parseLayerId(url);
        if (layerId != null) break;
    }

    return { itemId, layerId };
}

function namespaceFor(record) {
    const landingPage = collapse(record && record.landingPage);
    if (!landingPage) return null;
    try {
        const parsed = new URL(landingPage);
        const host = parsed.hostname.toLowerCase();
        const parts = host.split('.');
        return parts.length >= 3 ? parts[0] : host;
    } catch {
        return null;
    }
}

function canonicalKey(identity) {
    if (!identity) return null;
    return identity.layerId == null ? identity.itemId : identity.itemId + ':' + identity.layerId;
}

function idsFor(identity) {
    const key = canonicalKey(identity).replace(':', '-');
    return {
        datasetId: 'arcgis-' + key,
        resourceId: 'arcgis-' + key + '-data'
    };
}

function canonicalPublisher(source, suppliedPublisher) {
    const raw = collapse(suppliedPublisher);
    if (Array.isArray(source.publisherAliases)) {
        for (const entry of source.publisherAliases) {
            if (entry.publisher.test(raw)) {
                return entry.name;
            }
        }
    }
    if (!raw || isPlaceholder(raw)) {
        return source.nameEn;
    }
    return raw;
}

function authoritativePublisher(source, publisher) {
    if (!Array.isArray(source.authoritativePublishers)) return true;
    for (const entry of source.authoritativePublishers) {
        if (entry.publisher.test(publisher)) {
            return true;
        }
    }
    return false;
}

function publisherName(record, item, source) {
    const supplied = collapse(record.publisher && record.publisher.name);
    if (supplied) {
        return canonicalPublisher(source, supplied);
    }
    const itemOwner = collapse(item && (item.owner || item.ownerUser));
    if (itemOwner) {
        return canonicalPublisher(source, itemOwner);
    }
    return source.nameEn;
}

function knownLicense(textLicense) {
    const text = collapse(textLicense);
    if (/creative\s*commons\s*attribution\s*4\.0|cc[\s_-]?by[\s_-]?4/i.test(text)) {
        return 'cc-by-4';
    }
    if (/open\s*government\s*licen[cs]e\s*[-–]\s*canada|canada[\s_-]?open[\s_-]?government/i.test(text)) {
        return 'ogl-canada';
    }
    if (/statistics\s*canada\s*open\s*licen[cs]e|statcan/i.test(text)) {
        return 'statcan';
    }
    return null;
}

function resolveLicense(source, record, item, namespace, publisher) {
    const textLicense = collapse(record.license) || collapse(item.licenseInfo) || collapse(item.accessInformation) || '';
    if (Array.isArray(source.restrictedLicensePatterns)) {
        for (const pattern of source.restrictedLicensePatterns) {
            if (pattern.test(textLicense)) return null;
        }
    }
    const matchedRule = matchRule(source.licenseRules, namespace, publisher);
    if (matchedRule) {
        return matchedRule.license;
    }
    return null;
}

function matchRule(rules, namespace, publisher) {
    if (!Array.isArray(rules)) return null;
    for (const rule of rules) {
        const nsMatch = !rule.namespace || rule.namespace === namespace;
        const pubMatch = !rule.publisher || (typeof rule.publisher === 'string' ? rule.publisher === publisher : rule.publisher.test(publisher));
        if (nsMatch && pubMatch) return rule;
    }
    return null;
}

function formatForDirectItem(record, item) {
    const type = collapse(item && item.type).toLowerCase();
    if (type === 'csv' || type === 'microsoft excel') {
        return type === 'csv' ? 'CSV' : 'XLSX';
    }
    const distributions = array(record.distribution);
    for (const dist of distributions) {
        const media = collapse(dist && dist.mediaType).toLowerCase();
        const fmt = collapse(dist && dist.format).toLowerCase();
        if (media.includes('csv') || fmt === 'csv') return 'CSV';
        if (media.includes('excel') || media.includes('spreadsheet') || fmt === 'xlsx' || fmt === 'xls') return 'XLSX';
    }
    return null;
}

function directUrl(identity, format, item, record) {
    const distributions = array(record.distribution);
    const target = distributions.find(d => {
        const media = collapse(d.mediaType).toLowerCase();
        const f = collapse(d.format).toLowerCase();
        return media.includes(format.toLowerCase()) || f.includes(format.toLowerCase());
    });
    if (target) return collapse(target.downloadURL || target.accessURL);
    return collapse(item && item.url);
}

function timestamp(value) {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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

    const licence = resolveLicense(source, record, item, namespace, publisher);
    if (!licence) {
        return { status: 'excluded', reason: 'unlicensed', externalId: canonicalKey(identity) };
    }

    const distributions = array(record.distribution);
    const geo = distributions.find(d => {
        const url = collapse(d.accessURL || d.downloadURL);
        return /FeatureServer|MapServer/i.test(url);
    });

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
    namespaceFor,
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
