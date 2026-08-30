const { getSource } = require('../config/catalogSources');
const { fetchPublicJson } = require('../utils/fetch');
const { htmlToText } = require('../utils/text');

function array(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function collapse(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ');
}

function slugKey(value) {
    return collapse(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseLayerId(url) {
    if (!url) return null;
    const match = url.match(/(?:FeatureServer|MapServer)\/(\d+)(?:\/|\?|$)/i);
    return match ? parseInt(match[1], 10) : null;
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
        return parsed.hostname.toLowerCase();
    } catch {
        return null;
    }
}

function canonicalKey(identity) {
    if (!identity) return null;
    return identity.layerId == null ? identity.itemId : identity.itemId + '_' + identity.layerId;
}

function idsFor(identity) {
    const key = canonicalKey(identity);
    return {
        datasetId: 'arcgis-item-' + key,
        datasetName: 'arcgis-item-' + key,
        resourceId: 'arcgis-res-' + key
    };
}

function publisherName(record, item, source) {
    const supplied = collapse(record.publisher && record.publisher.name);
    if (supplied) {
        const aliased = matchAlias(source.publisherAliases, supplied);
        if (aliased) return aliased;
        return supplied;
    }
    const itemOwner = collapse(item && (item.owner || item.ownerUser));
    if (itemOwner) {
        const aliased = matchAlias(source.publisherAliases, itemOwner);
        if (aliased) return aliased;
        return itemOwner;
    }
    return source.nameEn;
}

function matchAlias(aliases, candidate) {
    if (!Array.isArray(aliases)) return null;
    for (const entry of aliases) {
        if (entry.publisher && entry.publisher.test(candidate)) {
            return entry.name;
        }
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

function serviceIsLeaf(layerMetadata) {
    if (!layerMetadata) return true;
    if (layerMetadata.type === 'Feature Layer' || layerMetadata.type === 'Table') return true;
    if (Array.isArray(layerMetadata.layers) && layerMetadata.layers.length > 0) return false;
    return true;
}

function licenseFor(record, item, source, namespace, publisher) {
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

function isAuthoritative(source, namespace, publisher) {
    if (!Array.isArray(source.authoritativePublishers)) return true;
    for (const rule of source.authoritativePublishers) {
        const nsMatch = !rule.namespace || rule.namespace === namespace;
        const pubMatch = !rule.publisher || (typeof rule.publisher === 'string' ? rule.publisher === publisher : rule.publisher.test(publisher));
        if (nsMatch && pubMatch) return true;
    }
    return false;
}

function distributionUrl(record, format) {
    const distributions = array(record.distribution);
    const target = distributions.find(d => {
        const media = collapse(d.mediaType).toLowerCase();
        const f = collapse(d.format).toLowerCase();
        return media.includes(format) || f.includes(format);
    });
    return target ? collapse(target.downloadURL || target.accessURL) : null;
}

function directUrl(identity, format, item, record) {
    const dist = distributionUrl(record, format);
    if (dist) return dist;
    const url = item.url;
    if (!url) return null;
    if (format === 'geojson') {
        return url + (identity.layerId != null ? '/' + identity.layerId : '/0') + '/query?where=1%3D1&outFields=*&f=geojson';
    }
    if (format === 'csv') {
        return url + (identity.layerId != null ? '/' + identity.layerId : '/0') + '/query?where=1%3D1&outFields=*&f=csv';
    }
    return null;
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

    const license = licenseFor(record, item, source, namespace, publisher);
    if (!license) return { status: 'excluded', reason: 'license-not-admitted', externalId: canonicalKey(identity) };

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

    const isAuth = isAuthoritative(source, namespace, suppliedPublisher || publisher);
    if (!isAuth) {
        return { status: 'excluded', reason: 'unrecognized-publisher', externalId: canonicalKey(identity) };
    }

    const placeRule = matchRule(source.placeRules, namespace, publisher);
    const ids = idsFor(identity);
    const rawTitle = record.title || (metadata && metadata.name) || item.title || ids.datasetId;
    const title = collapse(htmlToText(rawTitle)) || ids.datasetId;
    const description = htmlToText(record.description || item.description || item.snippet || '');
    const keywords = Array.from(new Set(array(record.keyword).concat(array(item.tags)).map(collapse).filter(Boolean)));
    const orgId = 'arcgis-publisher-' + (slugKey(publisher) || 'government-publisher');

    const dataset = {
        id: ids.datasetId,
        source_id: source.id,
        name: ids.datasetName,
        title_en: title,
        title_fr: title,
        notes_en: description,
        notes_fr: description,
        org_id: orgId,
        authoritative: isAuth,
        url: collapse(record.landingPage) || 'https://www.arcgis.com/home/item.html?id=' + identity.itemId,
        license_id: license.titleEn,
        license_title: license.titleEn,
        license_url: license.url,
        attribution_en: license.attributionEn,
        attribution_fr: license.attributionFr,
        keywords,
        raw: {
            identity,
            record,
            item,
            layerMetadata: metadata
        }
    };

    const organization = {
        id: orgId,
        name: slugKey(publisher) || 'government-publisher',
        title_en: publisher,
        title_fr: publisher,
        description_en: '',
        description_fr: '',
        raw: { publisher }
    };

    const downloadUrl = directUrl(identity, 'csv', item, record) || collapse(record.landingPage);
    const resource = {
        id: ids.resourceId,
        dataset_id: ids.datasetId,
        name_en: title,
        name_fr: title,
        format: 'CSV',
        url: downloadUrl,
        size_bytes: null,
        datastore_active: false,
        raw: {
            identity,
            downloadUrl
        }
    };

    const places = placeRule ? [{
        place_id: placeRule.placeId,
        relationship: placeRule.relationship || 'direct',
        includes_descendants: !!placeRule.includesDescendants
    }] : [];

    let map = null;
    if (serviceUrl) {
        map = {
            resource_id: ids.resourceId,
            mode: 'arcgis-feature-layer',
            service_url: serviceUrl,
            layer_id: identity.layerId != null ? identity.layerId : 0
        };
    }

    return {
        status: 'included',
        externalId: canonicalKey(identity),
        dataset,
        organization,
        source,
        resource,
        places,
        map
    };
}

module.exports = {
    identityFor,
    namespaceFor,
    canonicalKey,
    idsFor,
    publisherName,
    licenseFor,
    isAuthoritative,
    serviceIsLeaf,
    enrichRecord
};
