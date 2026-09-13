// Pure SEO helpers: route classification, safe HTML/JSON-LD escaping, per-page
// <head> building (title/description/canonical/OpenGraph/Twitter) and
// schema.org JSON-LD (Dataset / WebSite / Organization). No DB, no fs, no
// Express - so it is fully unit-testable and reused by both the SPA head
// injector (controllers/spaController.js) and any other caller.
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { classifyResource } = require('./resourceCapabilities');
const { plainText, collapse, truncate, resourceLanguages } = require('./catalogText');

const SITE_URL = (process.env.SITE_URL || 'https://canquery.com').replace(/\/+$/, '');
const SITE_NAME = 'CanQuery';
const DEFAULT_TITLE = 'CanQuery: Canadian open data search, tables & maps';
const DEFAULT_DESC =
    'Search Canadian open data by place, load CSV and Excel files into live tables, and explore spatial data on a map. No signup.';
const DEFAULT_IMAGE = SITE_URL + '/og-image.svg';
const REPO_URL = 'https://github.com/RyuPrad/canquery';
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 160;
const TITLE_SUFFIX = ' - CanQuery';
const DATASET_DESCRIPTION_MIN = 50;

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// JSON-LD lives inside a <script> element, so the serialized JSON must not be
// able to break out of it. Escaping < > & to their \u form keeps the payload
// valid JSON while making "</script>" and "<!--" impossible to form.
function jsonLdScript(obj) {
    const json = JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    return '<script type="application/ld+json">' + json + '</script>';
}

// English-default site: prefer the EN value, fall back to FR when EN is blank.
function pick(en, fr) {
    return plainText(en) || plainText(fr) || '';
}

function siteTitle(value) {
    return truncate(collapse(value) || 'Open data', TITLE_MAX - TITLE_SUFFIX.length) + TITLE_SUFFIX;
}

const GENERIC_RESOURCE_NAMES = new Set([
    'data', 'dataset', 'download', 'english', 'en', 'file', 'french', 'fr',
    'francais', 'français', 'ensembles de données', 'ensemble de données', 'resource', 'csv', 'xls', 'xlsx', 'json', 'geojson',
    'xml', 'pdf', 'zip'
]);

function isGenericResourceName(value, format) {
    const normalized = collapse(value).toLowerCase().replace(/[._-]+/g, ' ');
    const normalizedFormat = collapse(format).toLowerCase();
    return !normalized || GENERIC_RESOURCE_NAMES.has(normalized) ||
        (normalizedFormat && normalized === normalizedFormat);
}

function isPeriodName(name) {
    return /^\d{4}(?:-\d{2}(?:-\d{2})?)?(?:\s*(?:to|au|à|[-–—/])\s*\d{4}(?:-\d{2}(?:-\d{2})?)?)?$/i.test(name) ||
        /^(?:[QT][1-4]\s+\d{4}|\d{4}\s+[QT][1-4])$/i.test(name);
}

function resourceSubject(resource) {
    const name = pick(resource.name_en, resource.name_fr);
    const datasetTitle = pick(resource.dataset_title_en, resource.dataset_title_fr);
    if (datasetTitle && isPeriodName(name)) return datasetTitle + ' — ' + name;
    return (isGenericResourceName(name, resource.format) ? datasetTitle : name) || datasetTitle;
}

function titleContainsFormat(value, format) {
    const normalizedFormat = collapse(format);
    if (!normalizedFormat) return true;
    const escaped = normalizedFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(value);
}

function resourceTitleBase(resource, max = null, lang = 'en') {
    const name = pick(resource.name_en, resource.name_fr);
    const datasetTitle = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const format = collapse(resource.format).toUpperCase();
    let base = resourceSubject(resource) || 'Resource';
    const languages = resourceLanguages(resource).map(code => lang === 'fr'
        ? (code === 'fr' ? 'français' : 'anglais') : (code === 'fr' ? 'French' : 'English'));
    const suffixParts = [...languages, format && !titleContainsFormat(base, format) ? format : ''].filter(Boolean);
    const suffix = suffixParts.length ? ' (' + suffixParts.join(', ') + ')' : '';
    if (max && datasetTitle && isPeriodName(name)) {
        const period = ' — ' + name;
        base = truncate(datasetTitle, Math.max(12, max - suffix.length - period.length)) + period;
    }
    return (max ? truncate(base, Math.max(12, max - suffix.length)) : base) + suffix;
}

function buildBreadcrumbJsonLd(items) {
    const unique = [];
    const paths = new Set();
    for (const item of items || []) {
        const name = collapse(item && item.name);
        const path = item && item.path;
        if (!name || !path) continue;
        const url = canonicalFor(path);
        if (paths.has(url)) continue;
        paths.add(url);
        unique.push({ name, url });
    }
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: unique.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: item.url
        }))
    };
}

function canonicalFor(pathname) {
    let p = pathname || '/';
    const q = p.indexOf('?');
    if (q !== -1) p = p.slice(0, q);
    if (p !== '/') p = p.replace(/\/+$/, '');
    if (!p.startsWith('/')) p = '/' + p;
    return SITE_URL + p;
}

function decodePathSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

function classifyRoute(pathname) {
    const p = (pathname || '/').replace(/\?.*$/, '');
    if (p === '/' || p === '') return { type: 'home' };
    let m = p.match(/^\/datasets\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'dataset', id };
    }
    m = p.match(/^\/resources\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'resource', id };
    }
    m = p.match(/^\/places\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'place', id };
    }
    m = p.match(/^\/organizations\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'organization', id };
    }
    if (/^\/datasets\/?$/.test(p)) return { type: 'datasets' };
    if (/^\/places\/?$/.test(p)) return { type: 'places' };
    if (/^\/insights\/?$/.test(p)) return { type: 'insights' };
    if (/^\/organizations\/?$/.test(p)) return { type: 'organizations' };
    if (/^\/docs\/?$/.test(p)) return { type: 'docs' };
    if (/^\/privacy\/?$/.test(p)) return { type: 'privacy' };
    return { type: 'other' };
}

const STATIC_META = {
    datasets: { path: '/datasets', title: 'Browse all Canadian datasets - CanQuery',
        description: 'Browse the complete Canadian open data catalogue: downloadable files, live tables and maps from federal, provincial and municipal publishers.' },
    home: { title: DEFAULT_TITLE, description: DEFAULT_DESC, path: '/' },
    insights: {
        title: 'Insights: Top 100 downloaded datasets - CanQuery',
        description:
            'The 100 most-downloaded datasets on open.canada.ca, loaded into CanQuery and turned into live charts you can explore.',
        path: '/insights',
    },
    organizations: {
        title: 'Organizations publishing Canadian open data - CanQuery',
        description:
            'Browse governments and public organizations publishing Canadian open data, ranked by how many datasets they have.',
        path: '/organizations',
    },
    places: {
        title: 'Canadian open data by place - CanQuery',
        description: 'Browse queryable and mappable open data for Canadian provinces, regions, and municipalities.',
        path: '/places',
    },
    docs: {
        title: 'API documentation - CanQuery',
        description:
            'Anonymous JSON API over Canadian federal and local open data: search by place, map spatial layers, load tables and query them live.',
        path: '/docs',
    },
    privacy: {
        title: 'Privacy and analytics - CanQuery',
        description:
            'How CanQuery uses anonymous, self-hosted product analytics, honors browser privacy signals, and protects visitor data.',
        path: '/privacy',
    },
};

function buildWebsiteJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        alternateName: DEFAULT_TITLE,
        url: SITE_URL + '/',
        description: DEFAULT_DESC,
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: SITE_URL + '/?q={search_term_string}',
            },
            'query-input': 'required name=search_term_string',
        },
    };
}

function buildOrganizationJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL + '/',
        logo: SITE_URL + '/favicon.svg',
        sameAs: [REPO_URL],
    };
}

// schema.org/Dataset - the markup that makes a page eligible for Google
// Dataset Search. `dataset` is a row from getDatasetByIdOrName; `resources`
// is the listResourcesForDataset rows (optional; used for distributions).
function sourceForDataset(dataset) {
    const sources = Array.isArray(dataset.provenance_sources) ? dataset.provenance_sources : [];
    return sources.find(source => source.authoritative && source.license_url) ||
        sources.find(source => source.license_url) ||
        sources.find(source => source.authoritative) ||
        sources[0] || null;
}

function absoluteHttpUrl(value) {
    if (!value) return null;
    try {
        const resolved = new URL(toAbsoluteUrl(value));
        return resolved.protocol === 'http:' || resolved.protocol === 'https:'
            ? resolved.toString()
            : null;
    } catch {
        return null;
    }
}

function humanFileSize(value) {
    if (value == null || value === '') return null;
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes < 1024) return Math.round(bytes) + ' bytes';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && amount >= 1024; i += 1) {
        amount /= 1024;
        unit = units[i];
    }
    return (amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)).replace(/\.0$/, '') + ' ' + unit;
}

function datasetDescription(dataset, resources, max = 5000) {
    const name = pick(dataset.title_en, dataset.title_fr) || 'This dataset';
    const notes = pick(dataset.notes_en, dataset.notes_fr);
    const org = pick(dataset.org_title_en, dataset.org_title_fr);
    const list = Array.isArray(resources) ? resources : [];
    const queryable = list.filter(resource => {
        const capability = classifyResource(resource).capability;
        return capability === 'datastore' || capability === 'ingested';
    }).length;
    const mapped = list.filter(resource => resource && (
        resource.map_provider || (resource.map && resource.map.available)
    )).length;
    const facts = [
        name + ' is an open dataset' + (org ? ' published by ' + org : ' available through CanQuery') + '.',
        list.length ? 'It contains ' + list.length + ' resource' + (list.length === 1 ? '' : 's') + '.' : '',
        queryable ? queryable + ' can be queried as a live table.' : '',
        mapped ? mapped + ' can be explored on a map.' : ''
    ].filter(Boolean).join(' ');
    let description = notes;
    if (description.length < DATASET_DESCRIPTION_MIN) {
        description = [description, facts].filter(Boolean).join(' ');
    }
    if (description.length < DATASET_DESCRIPTION_MIN) {
        description += ' Search and explore the public data on CanQuery.';
    }
    return truncate(description, max);
}

function buildDatasetJsonLd(dataset, resources) {
    const name = pick(dataset.title_en, dataset.title_fr) || 'Dataset';
    const slug = dataset.name || dataset.id;
    const url = SITE_URL + '/datasets/' + encodeURIComponent(slug);
    const description = datasetDescription(dataset, resources, 5000);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name,
        description,
        url,
        identifier: dataset.id,
        isAccessibleForFree: true,
    };
    const alternateName = plainText(dataset.title_fr);
    if (alternateName && alternateName.toLocaleLowerCase('fr-CA') !== name.toLocaleLowerCase('fr-CA')) {
        ld.alternateName = alternateName;
    }
    const source = sourceForDataset(dataset);
    ld.license = source && source.license_url
        ? source.license_url
        : 'https://open.canada.ca/en/open-government-licence-canada';
    ld.sameAs = source && source.landing_url
        ? source.landing_url
        : 'https://open.canada.ca/data/en/dataset/' + dataset.id;
    const keywords = []
        .concat(dataset.keywords_en || [], dataset.keywords_fr || [])
        .map(collapse)
        .filter(Boolean);
    if (keywords.length) ld.keywords = Array.from(new Set(keywords)).slice(0, 50);
    if (dataset.metadata_modified) {
        const d = new Date(dataset.metadata_modified);
        if (!Number.isNaN(d.getTime())) ld.dateModified = d.toISOString();
    }
    const org = pick(dataset.org_title_en, dataset.org_title_fr);
    if (org) {
        ld.creator = { '@type': 'GovernmentOrganization', name: org };
    }
    const publisher = source ? pick(source.name_en, source.name_fr) : 'Government of Canada';
    if (publisher) ld.publisher = { '@type': 'Organization', name: publisher };
    const places = (Array.isArray(dataset.places) ? dataset.places : [])
        .map(place => pick(place.name_en, place.name_fr))
        .filter(Boolean);
    if (places.length) ld.spatialCoverage = Array.from(new Set(places));
    const distribution = [];
    for (const resource of resources || []) {
        if (distribution.length >= 25) break;
        const contentUrl = absoluteHttpUrl(resource && resource.url);
        if (!contentUrl) continue;
        const dl = { '@type': 'DataDownload', contentUrl };
        const fmt = plainText(resource.format);
        if (fmt) dl.encodingFormat = fmt;
        const resourceName = pick(resource.name_en, resource.name_fr);
        if (resourceName) dl.name = resourceName;
        const size = humanFileSize(resource.size_bytes);
        if (size) dl.contentSize = size;
        distribution.push(dl);
    }
    if (distribution.length) ld.distribution = distribution;
    return ld;
}

function homeMeta() {
    return {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESC,
        canonical: SITE_URL + '/',
        ogType: 'website',
        jsonLd: [buildWebsiteJsonLd(), buildOrganizationJsonLd()],
    };
}

function staticMeta(type, pathname) {
    if (type === 'home') return homeMeta();
    const entry = STATIC_META[type];
    if (entry) {
        return {
            title: entry.title,
            description: entry.description,
            canonical: SITE_URL + entry.path,
            ogType: 'website',
        };
    }
    // Unknown route -> the SPA renders a not-found page; keep it out of the index.
    return {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESC,
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true,
    };
}

function datasetMeta(dataset, resources) {
    const title = pick(dataset.title_en, dataset.title_fr) || 'Dataset';
    const description = datasetDescription(dataset, resources, DESCRIPTION_MAX);
    const slug = dataset.name || dataset.id;
    // Keep the official catalogue name in the page and Dataset schema while
    // giving this frequently searched, long-titled dataset a complete snippet.
    const snippet = dataset.id === '90fed587-1364-4f33-a9ee-208181dc0b97' ? {
        title: 'Positive LMIA Employer Lists (TFWP) - CanQuery',
        description: 'Browse official positive LMIA employer lists by quarter and language, with CSV and Excel downloads from Canada’s open data portal.'
    } : null;
    return {
        title: snippet ? snippet.title : siteTitle(title),
        description: snippet ? snippet.description : description,
        canonical: SITE_URL + '/datasets/' + encodeURIComponent(slug),
        ogType: 'website',
        jsonLd: [
            buildDatasetJsonLd(dataset, resources),
            buildBreadcrumbJsonLd([
                { name: 'Datasets', path: '/datasets' },
                { name: title, path: '/datasets/' + encodeURIComponent(slug) }
            ])
        ],
    };
}

function resourceDescription(resource, { lang = 'en', max = DESCRIPTION_MAX } = {}) {
    const capability = classifyResource(resource).capability;
    const subject = resourceSubject(resource) || 'open data';
    const language = resourceLanguages(resource).map(lang => lang === 'fr' ? 'French' : 'English').join('/');
    const format = [language, plainText(resource.format).toUpperCase()].filter(Boolean).join(' ');
    const mapped = Boolean(resource.map_provider || resource.map?.available);
    let action;
    if (capability === 'datastore' || capability === 'ingested') {
        action = 'Query, filter, chart and export this live ' + (format ? format + ' ' : '') + 'table';
    } else if (capability === 'ingestable') {
        action = 'Load this ' + (format ? format + ' ' : '') + 'resource into a live table';
    } else {
        action = 'View metadata and access the original ' + (format ? format + ' ' : '') + 'file';
    }
    if (lang === 'fr') {
        const localizedFormat = [resourceLanguages(resource).map(code => code === 'fr' ? 'français' : 'anglais').join('/'),
            plainText(resource.format).toUpperCase()].filter(Boolean).join(' ');
        if (capability === 'datastore' || capability === 'ingested') {
            action = 'Recherchez, filtrez et exportez ce tableau ' + localizedFormat;
        } else if (capability === 'ingestable') {
            action = 'Chargez ce fichier ' + localizedFormat + ' pour explorer son tableau';
        } else {
            action = 'Consultez les métadonnées et le fichier original ' + localizedFormat;
        }
    }
    // Mapping is independent of the table capability and must survive truncation.
    if (mapped) action = (lang === 'fr' ? 'Explorez la carte interactive. ' : 'Explore the interactive map. ') + action;
    return truncate(action + ': ' + subject + '.', max);
}

function buildResourceJsonLd(resource, description) {
    const name = pick(resource.name_en, resource.name_fr) || resourceTitleBase(resource);
    const datasetName = pick(resource.dataset_title_en, resource.dataset_title_fr) || 'Dataset';
    const datasetSlug = resource.dataset_name || resource.dataset_id;
    const download = {
        '@type': 'DataDownload',
        name,
        encodingFormat: plainText(resource.format) || undefined,
        contentSize: humanFileSize(resource.size_bytes) || undefined,
        contentUrl: absoluteHttpUrl(resource.url) || undefined,
        isPartOf: datasetSlug ? {
            '@type': 'Dataset',
            name: datasetName,
            url: SITE_URL + '/datasets/' + encodeURIComponent(datasetSlug)
        } : undefined
    };
    for (const key of Object.keys(download)) {
        if (download[key] === undefined) delete download[key];
    }
    const source = sourceForDataset(resource);
    if (source && source.license_url) download.license = source.license_url;
    return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name,
        description,
        url: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        mainEntity: download
    };
}

function resourceMeta(resource) {
    const name = pick(resource.name_en, resource.name_fr) || 'Resource';
    const ds = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const datasetSlug = resource.dataset_name || resource.dataset_id;
    const description = resourceDescription(resource);
    return {
        title: resourceTitleBase(resource, TITLE_MAX - TITLE_SUFFIX.length) + TITLE_SUFFIX,
        description,
        canonical: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        ogType: 'website',
        jsonLd: [buildResourceJsonLd(resource, description), buildBreadcrumbJsonLd([
            { name: 'Datasets', path: '/datasets' },
            datasetSlug && ds ? {
                name: ds,
                path: '/datasets/' + encodeURIComponent(datasetSlug)
            } : null,
            { name, path: '/resources/' + encodeURIComponent(resource.id) }
        ])]
    };
}

function placeMeta(place, datasets = []) {
    const name = pick(place.name_en, place.name_fr) || 'Place';
    const type = pick(place.type_en, place.type_fr);
    const datasetCount = Number(place.dataset_count) || 0;
    const mapCount = Number(place.mappable_dataset_count) || 0;
    const description = 'Explore ' + datasetCount.toLocaleString('en-CA') + ' open dataset' +
        (datasetCount === 1 ? '' : 's') + ' for ' + name +
        (mapCount ? ', including ' + mapCount.toLocaleString('en-CA') + ' with interactive maps' : '') +
        (type ? ' (' + type + ')' : '') + ' on CanQuery.';
    const slug = place.slug || place.id;
    const placePath = '/places/' + encodeURIComponent(slug);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'AdministrativeArea',
        name,
        url: SITE_URL + '/places/' + encodeURIComponent(slug),
        identifier: place.id
    };
    if (place.latitude != null && place.longitude != null) {
        ld.geo = {
            '@type': 'GeoCoordinates',
            latitude: Number(place.latitude),
            longitude: Number(place.longitude)
        };
    }
    const collection = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: name + ' open data',
        description: truncate(description, DESCRIPTION_MAX),
        url: SITE_URL + placePath,
        about: {
            '@type': 'AdministrativeArea',
            name,
            url: SITE_URL + placePath,
            identifier: place.id
        },
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: datasetCount,
            itemListElement: (datasets || []).slice(0, 12).map((dataset, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: pick(dataset.title_en, dataset.title_fr) || dataset.name || dataset.id,
                url: SITE_URL + '/datasets/' + encodeURIComponent(dataset.name || dataset.id)
            }))
        }
    };
    return {
        title: siteTitle(name + ' open data'),
        description: truncate(description, DESCRIPTION_MAX),
        canonical: SITE_URL + placePath,
        ogType: 'website',
        noindex: datasetCount === 0,
        jsonLd: [ld, collection, buildBreadcrumbJsonLd([
            { name: 'Places', path: '/places' },
            ...(Array.isArray(place.ancestors) ? place.ancestors.map(ancestor => ({
                name: pick(ancestor.name_en, ancestor.name_fr),
                path: '/places/' + encodeURIComponent(ancestor.slug || ancestor.id)
            })) : []),
            { name, path: placePath }
        ])]
    };
}

function organizationMeta(organization, datasets = []) {
    const name = pick(organization.title_en, organization.title_fr) || organization.name || 'Organization';
    const organizationPath = '/organizations/' + encodeURIComponent(organization.name);
    const total = Number(organization.dataset_count) || 0;
    const queryable = Number(organization.queryable_dataset_count) || 0;
    const mappable = Number(organization.mappable_dataset_count) || 0;
    const capabilities = [
        queryable ? queryable + ' queryable dataset' + (queryable === 1 ? '' : 's') : '',
        mappable ? mappable + ' with interactive maps' : ''
    ].filter(Boolean).join(' and ');
    const description = truncate(
        'Explore ' + total.toLocaleString('en-CA') + ' open dataset' + (total === 1 ? '' : 's') +
        ' from ' + name + ' on CanQuery' + (capabilities ? ', including ' + capabilities : '') + '.',
        DESCRIPTION_MAX
    );
    const items = (datasets || []).slice(0, 12).map((dataset, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: pick(dataset.title_en, dataset.title_fr) || dataset.name || dataset.id,
        url: SITE_URL + '/datasets/' + encodeURIComponent(dataset.name || dataset.id)
    }));
    const collection = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: name + ' open data',
        description,
        url: SITE_URL + organizationPath,
        about: {
            '@type': 'GovernmentOrganization',
            name,
            identifier: organization.id
        },
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: total,
            itemListElement: items
        }
    };
    return {
        title: siteTitle(name + ' open data'),
        description,
        canonical: SITE_URL + organizationPath,
        ogType: 'website',
        noindex: total === 0,
        jsonLd: [collection, buildBreadcrumbJsonLd([
            { name: 'Organizations', path: '/organizations' },
            { name, path: organizationPath }
        ])]
    };
}

function notFoundMeta(pathname) {
    return {
        title: 'Not found - CanQuery',
        description: DEFAULT_DESC,
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true,
    };
}

function serviceUnavailableMeta(pathname) {
    return {
        title: 'Temporarily unavailable - CanQuery',
        description: 'This CanQuery page is temporarily unavailable. Please try again shortly.',
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true
    };
}

// Build the managed <head> tag list for a resolved meta object.
function buildManagedTags(meta) {
    const title = escapeHtml(meta.title || DEFAULT_TITLE);
    const description = escapeHtml(meta.description || DEFAULT_DESC);
    const url = escapeHtml(meta.canonical || SITE_URL + '/');
    const image = escapeHtml(meta.image || DEFAULT_IMAGE);
    const ogType = escapeHtml(meta.ogType || 'website');
    const tags = [];
    if (meta.noindex) tags.push('<meta name="robots" content="noindex, follow" />');
    tags.push('<title>' + title + '</title>');
    tags.push('<meta name="description" content="' + description + '" />');
    tags.push('<link rel="canonical" href="' + url + '" />');
    for (const [language, href] of Object.entries(meta.alternates || {})) {
        tags.push('<link rel="alternate" hreflang="' + escapeHtml(language) + '" href="' + escapeHtml(href) + '" />');
    }
    if (meta.lang) tags.push('<meta property="og:locale" content="' + (meta.lang === 'fr' ? 'fr_CA' : 'en_CA') + '" />');
    tags.push('<meta property="og:title" content="' + title + '" />');
    tags.push('<meta property="og:description" content="' + description + '" />');
    tags.push('<meta property="og:type" content="' + ogType + '" />');
    tags.push('<meta property="og:url" content="' + url + '" />');
    tags.push('<meta property="og:site_name" content="CanQuery" />');
    tags.push('<meta property="og:image" content="' + image + '" />');
    tags.push('<meta name="twitter:card" content="summary_large_image" />');
    tags.push('<meta name="twitter:title" content="' + title + '" />');
    tags.push('<meta name="twitter:description" content="' + description + '" />');
    tags.push('<meta name="twitter:image" content="' + image + '" />');
    for (const obj of meta.jsonLd || []) tags.push(jsonLdScript(obj));
    return tags;
}

// Replace the <!-- seo:start --> ... <!-- seo:end --> block in the SPA
// template with freshly built tags. If the markers are absent (template
// changed), return the template untouched - serving valid default HTML.
function renderHtml(template, meta, bodyHtml = '') {
    const re = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
    let html = meta.lang ? template.replace(/<html\b[^>]*>/, '<html lang="' + escapeHtml(meta.lang) + '">') : template;
    if (re.test(html)) {
        const block = buildManagedTags(meta)
            .map((line) => '    ' + line)
            .join('\n');
        // The replacement must be a function: a string replacement interprets
        // $&, $', $` and $$ as substitution patterns, and catalogue text can
        // otherwise re-inject the matched block.
        html = html.replace(re, () => '<!-- seo:start -->\n' + block + '\n    <!-- seo:end -->');
    }
    if (bodyHtml && /<div id="root">\s*<\/div>/.test(html)) {
        html = html.replace(
            /<div id="root">\s*<\/div>/,
            () => '<div id="root">' + bodyHtml + '</div>'
        );
    }
    return html;
}

module.exports = {
    SITE_URL,
    SITE_NAME,
    DEFAULT_TITLE,
    DEFAULT_DESC,
    escapeHtml,
    jsonLdScript,
    plainText,
    truncate,
    classifyRoute,
    canonicalFor,
    buildWebsiteJsonLd,
    buildOrganizationJsonLd,
    buildDatasetJsonLd,
    datasetDescription,
    buildBreadcrumbJsonLd,
    isGenericResourceName,
    resourceTitleBase,
    resourceDescription,
    siteTitle,
    homeMeta,
    staticMeta,
    datasetMeta,
    resourceMeta,
    placeMeta,
    organizationMeta,
    notFoundMeta,
    serviceUnavailableMeta,
    buildManagedTags,
    renderHtml,
};
