const { normalizeCatalogLicense } = require('./catalogWrite');
const { getSource } = require('../config/catalogSources');

function patternMatches(value, pattern) {
    if (!value || !pattern) {
        return false;
    }
    if (pattern instanceof RegExp) {
        return pattern.test(value);
    }
    return String(value).toLowerCase().includes(String(pattern).toLowerCase());
}

function canonicalPublisher(source, value) {
    if (!value) {
        return null;
    }
    const aliases = source.publisherAliases || [];
    for (const alias of aliases) {
        if (patternMatches(value, alias.publisher)) {
            return alias.name;
        }
    }
    return String(value).trim();
}

function publisherName(source, dataset) {
    const rawPublisher = dataset.publisher && dataset.publisher.name
        ? dataset.publisher.name
        : (dataset.attributes && (dataset.attributes.source || dataset.attributes.owner || dataset.attributes.orgName)) || null;

    if (!rawPublisher) {
        return null;
    }
    return canonicalPublisher(source, rawPublisher);
}

function ruleMatches(value, rulePattern) {
    if (!rulePattern) {
        return true;
    }
    return patternMatches(value, rulePattern);
}

function matchRule(rules, publisher, candidateLicenseText) {
    if (!rules || rules.length === 0) {
        return null;
    }
    for (const rule of rules) {
        const matchesPublisher = ruleMatches(publisher, rule.publisher);
        const matchesLicense = !rule.licensePattern || (candidateLicenseText && patternMatches(candidateLicenseText, rule.licensePattern));
        if (matchesPublisher && matchesLicense) {
            return rule;
        }
    }
    return null;
}

function authoritativePublisher(source, publisher) {
    if (!publisher) {
        return false;
    }
    const rules = source.authoritativePublishers || [];
    if (rules.length === 0) {
        return true;
    }
    for (const rule of rules) {
        if (ruleMatches(publisher, rule.publisher)) {
            return true;
        }
    }
    return false;
}

function isRestrictedLicense(source, candidateText) {
    if (!candidateText) {
        return false;
    }
    const patterns = source.restrictedLicensePatterns || [];
    for (const pattern of patterns) {
        if (patternMatches(candidateText, pattern)) {
            return true;
        }
    }
    return false;
}

function resolveLicense(source, publisher, candidateText) {
    if (isRestrictedLicense(source, candidateText)) {
        return null;
    }
    const matchedRule = matchRule(source.licenseRules, publisher, candidateText);
    if (matchedRule && matchedRule.license) {
        return normalizeCatalogLicense(matchedRule.license);
    }
    if (candidateText) {
        const known = normalizeCatalogLicense(candidateText);
        if (known && known.url) {
            return known;
        }
    }
    return null;
}

function resolvePlaceAssignments(source, publisher) {
    const rules = source.placeRules || [];
    const assignments = [];
    for (const rule of rules) {
        if (ruleMatches(publisher, rule.publisher)) {
            assignments.push({
                placeId: rule.placeId,
                relationship: rule.relationship || 'direct'
            });
        }
    }
    return assignments;
}

class ArcgisHubAdapter {
    constructor(source) {
        this.source = source;
    }

    normalizeDataset(dataset) {
        const attrs = dataset.attributes || dataset;
        const id = dataset.id || attrs.id;
        const titleEn = attrs.name || attrs.title || null;
        if (!id || !titleEn) {
            return null;
        }

        const publisher = publisherName(this.source, dataset);
        if (!authoritativePublisher(this.source, publisher)) {
            return null;
        }

        const licenseCandidate = attrs.license || attrs.licenseTitle || attrs.licenseUrl || null;
        const license = resolveLicense(this.source, publisher, licenseCandidate);
        if (!license) {
            return null;
        }

        const rawUrl = attrs.url || (this.source.homepageUrl ? this.source.homepageUrl.replace(/\/$/, '') + '/datasets/' + id : null);
        const resources = [];

        if (rawUrl) {
            resources.push({
                id: id + '-csv',
                format: 'csv',
                url: rawUrl + '.csv',
                titleEn: 'CSV'
            });
            resources.push({
                id: id + '-geojson',
                format: 'geojson',
                url: rawUrl + '.geojson',
                titleEn: 'GeoJSON'
            });
        }

        return {
            id: id,
            titleEn: titleEn,
            titleFr: null,
            descriptionEn: attrs.description || null,
            descriptionFr: null,
            organizationName: publisher || this.source.nameEn,
            organizationTitleEn: publisher || this.source.nameEn,
            organizationTitleFr: null,
            licenseTitleEn: license.titleEn,
            licenseTitleFr: license.titleFr,
            licenseUrl: license.url,
            licenseAttributionEn: license.attributionEn,
            licenseAttributionFr: license.attributionFr,
            sourceId: this.source.id,
            catalogUrl: rawUrl,
            tags: attrs.tags || [],
            categories: attrs.categories || [],
            placeAssignments: resolvePlaceAssignments(this.source, publisher),
            resources: resources
        };
    }

    normalizeDcatUsDataset(dataset) {
        const id = dataset.identifier || dataset.id;
        const titleEn = dataset.title || null;
        if (!id || !titleEn) {
            return null;
        }

        const publisher = publisherName(this.source, dataset);
        if (!authoritativePublisher(this.source, publisher)) {
            return null;
        }

        const licenseCandidate = dataset.license || null;
        const license = resolveLicense(this.source, publisher, licenseCandidate);
        if (!license) {
            return null;
        }

        const distributions = dataset.distribution || [];
        const resources = distributions.map((dist, idx) => {
            const rawFormat = (dist.format || '').toLowerCase();
            let format = rawFormat;
            if (rawFormat.includes('csv')) format = 'csv';
            else if (rawFormat.includes('geo+json') || rawFormat.includes('geojson')) format = 'geojson';
            else if (rawFormat.includes('zip') || rawFormat.includes('shapefile')) format = 'zip';

            return {
                id: id + '-' + idx,
                format: format || 'unknown',
                url: dist.downloadURL || dist.accessURL,
                titleEn: dist.title || format.toUpperCase()
            };
        });

        return {
            id: id,
            titleEn: titleEn,
            titleFr: null,
            descriptionEn: dataset.description || null,
            descriptionFr: null,
            organizationName: publisher || this.source.nameEn,
            organizationTitleEn: publisher || this.source.nameEn,
            organizationTitleFr: null,
            licenseTitleEn: license.titleEn,
            licenseTitleFr: license.titleFr,
            licenseUrl: license.url,
            licenseAttributionEn: license.attributionEn,
            licenseAttributionFr: license.attributionFr,
            sourceId: this.source.id,
            catalogUrl: dataset.landingPage || dataset.accessURL || null,
            tags: dataset.keyword || [],
            categories: dataset.theme || [],
            placeAssignments: resolvePlaceAssignments(this.source, publisher),
            resources: resources
        };
    }
}

module.exports = {
    ArcgisHubAdapter,
    patternMatches,
    canonicalPublisher,
    publisherName,
    ruleMatches,
    matchRule,
    authoritativePublisher,
    isRestrictedLicense,
    resolveLicense,
    resolvePlaceAssignments
};
