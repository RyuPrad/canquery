const seo = require('./seoMeta');
const { listArticles } = require('./blogContent');

// Guides about a dataset in both languages; the French edition is labelled.
const datasetGuides = dataset => ['en', 'fr'].flatMap(lang => listArticles({ lang, dataset })
    .map(article => ({ path: article.path, label: article.title, detail: lang === 'fr' ? '(français)' : '' })));
const { classifyResource } = require('./resourceCapabilities');
const catalogFacts = require('./catalogFacts');
const { datasetPresentation, resourcePresentation } = require('./catalogPresentation');
const { hostedRoute, pageOverride } = require('../extensions');
const { adsenseClient } = require('./adsense');

const { PAGE_SIZE, pagePath } = require('./catalogPagination');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const MAX_LINKS = 12;
const MAX_SUMMARY = 1200;

function text(value) {
    return seo.escapeHtml(seo.plainText(value));
}

function pathLink(path, label) {
    const cleanLabel = seo.plainText(label);
    if (!path || !cleanLabel) return '';
    return '<a href="' + seo.escapeHtml(path) + '">' + seo.escapeHtml(cleanLabel) + '</a>';
}

// A publisher file URL made absolute and checked: http(s) only, no credentials.
function safeHttpUrl(value) {
    try {
        const url = new URL(toAbsoluteUrl(value));
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

// Every snapshot opens with links to the site's sections, so a crawler that
// never runs the application still reaches the hubs and both guide indexes.
const SECTION_LINKS = [
    ['/datasets', 'Datasets'], ['/places', 'Places'], ['/organizations', 'Organizations'], ['/insights', 'Insights'],
    ['/blog', 'Data guides'], ['/fr/blog', 'Guides des données'], ['/docs', 'API docs'], ['/about', 'About']
];
function sectionNav() {
    return '<nav aria-label="CanQuery sections" data-cq-sections="true"><ul>' +
        SECTION_LINKS.map(([path, label]) => '<li>' + pathLink(path, label) + '</li>').join('') + '</ul></nav>';
}

function breadcrumb(items) {
    const entries = (items || []).filter(item => item && item.label);
    if (!entries.length) return '';
    return '<nav aria-label="Breadcrumb"><ol>' + entries.map((item, index) => {
        const content = item.path && index < entries.length - 1
            ? pathLink(item.path, item.label)
            : '<span aria-current="page">' + text(item.label) + '</span>';
        return '<li>' + content + '</li>';
    }).join('') + '</ol></nav>';
}

function factList(facts) {
    const entries = (facts || []).filter(fact => fact && fact.value !== null && fact.value !== undefined && fact.value !== '');
    if (!entries.length) return '';
    return '<dl>' + entries.map(fact => '<div><dt>' + text(fact.label) + '</dt><dd>' + text(fact.value) +
        '</dd></div>').join('') + '</dl>';
}

// `extra` is a second, independent link on the same line (a file's direct
// download beside its page), so the file stays reachable from an indexed page.
function linkList(title, links, limit = MAX_LINKS) {
    const entries = (links || []).filter(link => link && link.path && link.label).slice(0, limit);
    if (!entries.length) return '';
    return '<section><h2>' + text(title) + '</h2><ul>' + entries.map(link =>
        '<li>' + pathLink(link.path, link.label) + (link.detail ? ' <span>' + text(link.detail) + '</span>' : '') +
        (link.extra && link.extra.path && link.extra.label ? ' · ' + pathLink(link.extra.path, link.extra.label) : '') + '</li>'
    ).join('') + '</ul></section>';
}

function paginationLinks(pagination) {
    if (!pagination || (pagination.page === 1 && !pagination.hasMore)) return '';
    const { page, path, hasMore } = pagination;
    return '<nav aria-label="Catalogue pages">' +
        (page > 1 ? pathLink(pagePath(path, page - 1), 'Previous') + ' ' + pathLink(path, '1') + ' ' : '') +
        '<span aria-current="page">Page ' + page + '</span>' +
        (hasMore ? ' ' + pathLink(pagePath(path, page + 1), String(page + 1)) + ' ' + pathLink(pagePath(path, page + 1), 'Next') : '') + '</nav>';
}

// `lead` is CanQuery's own paragraph about the record (facts and what a visitor
// can do here); the publisher's text follows it as `summary`. Later pages of a
// paginated list name their page in the heading so no two pages read alike.
// `sections` are extra link lists placed before the main list (a hub's
// publishers, portals and tables); `relatedTitle` names the related list.
function shell({ breadcrumbs, title, lead = '', summary, facts, linksTitle, links, linksLimit, sections = [],
    relatedTitle = 'Related open data', relatedLinks, overviewHtml = '', sources = [], guides = [], pagination }) {
    const heading = pagination && pagination.page > 1 ? title + ' (page ' + pagination.page + ')' : title;
    return '<main class="cq-seo-snapshot max-w-5xl mx-auto px-4 py-8" data-cq-seo-snapshot="true">' + sectionNav() +
        breadcrumb(breadcrumbs) + '<article><h1>' + text(heading) + '</h1>' +
        (lead ? '<p data-cq-lead="true">' + text(lead) + '</p>' : '') +
        (summary ? '<p>' + text(seo.truncate(summary, MAX_SUMMARY)) + '</p>' : '') +
        factList(facts) + overviewHtml +
        sections.map(section => linkList(section.title, section.links, section.limit || MAX_LINKS)).join('') +
        linkList('Official sources and licences', sources) +
        linkList(linksTitle, links, linksLimit || (pagination ? PAGE_SIZE : MAX_LINKS)) + paginationLinks(pagination) +
        linkList(relatedTitle, relatedLinks) + linkList('Data guides', guides) + '</article></main>';
}

function sourceLinks(row) {
    const links = [];
    for (const source of Array.isArray(row.provenance_sources) ? row.provenance_sources : []) {
        for (const [url, label] of [
            [source.landing_url || source.homepage_url, source.name_en || source.name_fr || 'Official source'],
            [source.license_url, source.license_title_en || source.license_title_fr || 'Licence']
        ]) {
            try {
                const parsed = new URL(url);
                if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !links.some(link => link.path === parsed.href)) {
                    links.push({ path: parsed.href, label });
                }
            } catch { /* Missing and invalid source URLs are omitted. */ }
        }
    }
    return links;
}

function overviewSnapshot(presentation, dataset = false) {
    const capabilities = presentation.capabilities;
    const actions = dataset ? [
        capabilities.ready && capabilities.ready + ' queryable resources',
        capabilities.loadable && capabilities.loadable + ' loadable resources',
        capabilities.mapped && capabilities.mapped + ' mapped resources'
    ].filter(Boolean) : [
        capabilities.table === 'ready' && 'Query table', capabilities.table === 'loadable' && 'Explore table (prepared automatically)',
        capabilities.map && 'Explore map', capabilities.download && 'Access original file'
    ].filter(Boolean);
    const fields = presentation.fields;
    const table = fields.total ? '<h3>Available fields (' + fields.items.length + '/' + fields.total + ')</h3><p>' +
        (fields.source === 'map' ? 'Fields from the recorded map schema.' : 'Fields from the loaded table schema.') +
        '</p><div class="overflow-x-auto"><table><thead><tr><th scope="col">Field</th><th scope="col">Recorded type</th></tr></thead><tbody>' +
        fields.items.map(field => '<tr><th scope="row">' + text(field.name) + '</th><td>' + text(field.type || 'Not recorded') + '</td></tr>').join('') +
        '</tbody></table></div>' : '';
    return '<section data-cq-overview><h2>Data overview</h2>' + factList([
        { label: 'Formats', value: presentation.formats.join(', ') },
        { label: 'File languages', value: presentation.languages.map(code => code === 'fr' ? 'French' : 'English').join(', ') },
        { label: 'Available actions', value: actions.join(' · ') }
    ]) + table + '</section>';
}

// CanQuery's own paragraph about a dataset: what it holds and what a visitor
// can do with it here, built only from catalogue facts.
function datasetLead(info) {
    const title = info.title || 'This dataset';
    const files = info.fileCount
        ? ' with ' + catalogFacts.formatCount(info.fileCount) + ' ' + catalogFacts.plural(info.fileCount, 'file') +
            (info.formats.length ? ' (' + info.formats.slice(0, 5).join(', ') + ')' : '')
        : '';
    const intro = title + ' is an open dataset' + (info.publisher ? ' from ' + info.publisher : '') + files +
        (info.updatedDate ? '; catalogue record updated ' + info.updatedDate : '') + '.';
    const actions = [];
    if (info.queryable) actions.push('preview ' + (info.queryable === 1 ? 'its live table' : catalogFacts.formatCount(info.queryable) + ' live tables'));
    if (info.loadable) actions.push('open ' + (info.loadable === 1 ? 'its CSV or Excel file as a table' : catalogFacts.formatCount(info.loadable) + ' CSV or Excel files as tables'));
    if (info.queryable || info.loadable) actions.push('filter, chart and export up to 10,000 rows as CSV');
    if (info.mapped) actions.push('explore ' + (info.mapped === 1 ? 'its interactive map' : catalogFacts.formatCount(info.mapped) + ' interactive maps'));
    actions.push(info.fileCount ? 'follow the original downloads' : 'read the publisher metadata and licence');
    return intro + ' On CanQuery you can ' + catalogFacts.joinList(actions) + '.' +
        (info.bilingual ? ' Files are available in English and French.' : '');
}

function datasetSnapshot(dataset, resources, pagination) {
    const presentation = datasetPresentation(dataset, resources);
    const info = catalogFacts.datasetFacts(dataset, resources);
    const title = seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id;
    const organization = seo.plainText(dataset.org_title_en) || seo.plainText(dataset.org_title_fr);
    const links = (pagination?.items || (resources || []).slice(0, MAX_LINKS)).map(resource => {
        const capability = classifyResource(resource).capability;
        // A download-only file's own page is not indexed, so its download is
        // offered here, from the dataset page that is.
        const download = capability === 'file-only' ? safeHttpUrl(resource.url) : '';
        return {
            path: '/resources/' + encodeURIComponent(resource.id),
            label: resourcePresentation({ ...resource, dataset_title_en: dataset.title_en, dataset_title_fr: dataset.title_fr }).title.en,
            detail: resource.format || catalogFacts.accessLabel(capability, { mapped: catalogFacts.isMapped(resource) }),
            ...(download ? { extra: { path: download, label: 'Download ' + (seo.plainText(resource.format) || 'file') } } : {})
        };
    });
    const placeLinks = (Array.isArray(dataset.places) ? dataset.places : []).map(place => ({
        path: '/places/' + encodeURIComponent(place.slug || place.id),
        label: seo.plainText(place.name_en) || seo.plainText(place.name_fr) || place.slug
    }));
    const organizationLinks = organization && dataset.org_name ? [{
        path: '/organizations/' + encodeURIComponent(dataset.org_name),
        label: organization
    }] : [];
    return shell({
        pagination,
        breadcrumbs: [{ label: 'Datasets', path: '/datasets' }, { label: title }],
        title,
        lead: datasetLead(info),
        summary: presentation.summary.en,
        overviewHtml: overviewSnapshot(presentation, true),
        sources: sourceLinks(dataset),
        guides: dataset.id || dataset.name ? datasetGuides(dataset.id || dataset.name) : [],
        facts: [
            organization ? {
                label: 'Publisher',
                value: organization
            } : null,
            { label: 'Resources', value: (resources || []).length },
            dataset.metadata_modified ? {
                label: 'Catalogue metadata updated',
                value: new Date(dataset.metadata_modified).toLocaleDateString('en-CA')
            } : null
        ],
        linksTitle: 'Resources',
        links,
        relatedLinks: organizationLinks.concat(placeLinks)
    });
}

function originalFileLink(resource) {
    const url = safeHttpUrl(resource.url);
    return url ? '<p>' + pathLink(url, 'Access original file') + '</p>' : '';
}

function resourceSnapshot(resource) {
    const presentation = resourcePresentation(resource);
    const name = presentation.title.en;
    const datasetName = seo.plainText(resource.dataset_title_en) || seo.plainText(resource.dataset_title_fr) || resource.dataset_name || resource.dataset_id;
    const datasetSlug = resource.dataset_name || resource.dataset_id;
    const organization = seo.plainText(resource.org_title_en) || seo.plainText(resource.org_title_fr);
    const capability = classifyResource(resource).capability;
    const info = catalogFacts.resourceFacts(resource);
    const links = [];
    if (organization && resource.org_name) {
        links.push({ path: '/organizations/' + encodeURIComponent(resource.org_name), label: organization });
    }
    for (const place of Array.isArray(resource.places) ? resource.places : []) {
        links.push({
            path: '/places/' + encodeURIComponent(place.slug || place.id),
            label: seo.plainText(place.name_en) || seo.plainText(place.name_fr) || place.slug
        });
    }
    return shell({
        breadcrumbs: [
            { label: 'Datasets', path: '/datasets' },
            { label: datasetName, path: '/datasets/' + encodeURIComponent(datasetSlug) },
            { label: name }
        ],
        title: name,
        summary: presentation.summary.en,
        overviewHtml: (presentation.context.en ? '<p>' + text(presentation.context.en) + '</p>' : '') +
            originalFileLink(resource) + overviewSnapshot(presentation),
        sources: sourceLinks(resource),
        guides: resource.dataset_id || resource.dataset_name ? datasetGuides(resource.dataset_id || resource.dataset_name) : [],
        facts: [
            { label: 'Format', value: resource.format || 'File' },
            { label: 'Access', value: catalogFacts.accessLabel(capability, { mapped: info.mapped }) },
            info.rows != null ? { label: 'Rows', value: catalogFacts.formatCount(info.rows) } : null,
            info.fields != null ? { label: 'Fields', value: catalogFacts.formatCount(info.fields) } : null,
            resource.size_bytes ? { label: 'Size', value: Number(resource.size_bytes).toLocaleString('en-CA') + ' bytes' } : null,
            resource.last_modified ? { label: 'Publisher-reported update', value: new Date(resource.last_modified).toLocaleDateString('en-CA') } : null
        ],
        linksTitle: 'Related open data',
        links
    });
}

const placeLabel = row => seo.plainText(row.name_en) || seo.plainText(row.name_fr) || row.slug || row.id;
const placeLink = row => ({ path: '/places/' + encodeURIComponent(row.slug || row.id), label: placeLabel(row),
    detail: catalogFacts.formatCount(row.dataset_count || 0) + ' datasets' });
const resourceLabel = row => seo.plainText(row.name_en) || seo.plainText(row.name_fr) ||
    seo.plainText(row.dataset_title_en) || seo.plainText(row.dataset_title_fr) || row.resource_id;

// The province or territory a place belongs to, from its ancestry.
function provinceOf(place) {
    const ancestor = (Array.isArray(place.ancestors) ? place.ancestors : [])
        .find(row => row && row.id !== place.id && ['province', 'territory'].includes(row.kind));
    return ancestor || null;
}

// CanQuery's own paragraph about a place: what it holds, by level and access,
// from how many publishers, and what the page offers below.
function placeLead({ name, type, province, count, maps, liveTables, levels, publishers }) {
    const where = [type, province].filter(Boolean).join(', ');
    const intro = name + (where ? ' (' + where + ')' : '') + ' has ' + catalogFacts.formatCount(count) + ' open ' +
        catalogFacts.plural(count, 'dataset') + ' on CanQuery' +
        (levels.length ? ': ' + catalogFacts.joinList(levels.map(([level, n]) => catalogFacts.formatCount(n) + ' ' + level)) : '') + '.';
    const access = [
        maps ? catalogFacts.formatCount(maps) + ' ' + catalogFacts.plural(maps, 'has', 'have') + ' an interactive map' : '',
        liveTables ? catalogFacts.formatCount(liveTables) + ' ' + catalogFacts.plural(liveTables, 'has', 'have') + ' a live table you can filter, chart and export' : ''
    ].filter(Boolean);
    const sentence = access.length ? ' ' + catalogFacts.joinList(access).replace(/^./, c => c.toUpperCase()) + '.' : '';
    const from = publishers ? ' They come from ' + catalogFacts.formatCount(publishers) + ' ' + catalogFacts.plural(publishers, 'publisher') + '.' : '';
    return intro + sentence + from + ' Below: the publishers and official portals, the most used and recently prepared tables, ' +
        'the datasets with maps, every dataset, the guides and nearby places.';
}

// The place page is the "<place> open data" landing page: the hub's optional
// sections appear on page one; later pages carry the dataset list only.
function placeSnapshot(place, datasets, pagination, hub = null) {
    const name = placeLabel(place);
    const type = seo.plainText(place.type_en) || seo.plainText(place.type_fr);
    const ancestors = (Array.isArray(place.ancestors) ? place.ancestors : []).filter(ancestor => ancestor.id !== place.id);
    const province = provinceOf(place);
    const slug = place.slug || place.id;
    const datasetLinks = (datasets || []).map(dataset => ({
        path: '/datasets/' + encodeURIComponent(dataset.name || dataset.id),
        label: seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id
    }));
    const count = Number(place.dataset_count) || 0;
    const maps = Number(place.mappable_dataset_count) || 0;
    const facets = hub && hub.facets ? hub.facets : null;
    const liveTables = seo.facetCount(facets, 'access', 'queryable');
    const levels = ['municipal', 'provincial', 'federal'].map(level => [level, seo.facetCount(facets, 'level', level)]).filter(([, n]) => n > 0);
    const organizations = hub ? hub.organizations : [];
    const publishers = facets && Array.isArray(facets.facets.organization) && facets.facets.organization.length
        ? facets.facets.organization.length : organizations.length;
    const firstPage = !pagination || pagination.page === 1;
    const sections = [];
    if (hub && firstPage) {
        if (organizations.length) sections.push({ title: 'Publishers', links: organizations.map(row => ({
            path: '/organizations/' + encodeURIComponent(row.name),
            label: seo.plainText(row.title_en) || seo.plainText(row.title_fr) || row.name,
            detail: catalogFacts.formatCount(row.dataset_count || 0) + ' datasets'
        })) });
        const portals = hub.sources.map(row => {
            const url = safeHttpUrl(row.homepage_url);
            return url ? { path: url, label: seo.plainText(row.name_en) || seo.plainText(row.name_fr) || row.id,
                detail: catalogFacts.formatCount(row.authoritative_dataset_count || row.dataset_count || 0) + ' datasets' } : null;
        }).filter(Boolean);
        if (portals.length) sections.push({ title: 'Official portals', links: portals });
        if (hub.popular.length) sections.push({ title: 'Popular tables', links: hub.popular.map(row => ({
            path: '/resources/' + encodeURIComponent(row.resource_id), label: resourceLabel(row),
            detail: catalogFacts.formatCount(row.hits || 0) + ' ' + catalogFacts.plural(Number(row.hits) || 0, 'query', 'queries') + ' this week'
        })) });
        if (hub.recent.length) sections.push({ title: 'Recently loaded tables', links: hub.recent.map(row => ({
            path: '/resources/' + encodeURIComponent(row.resource_id), label: resourceLabel(row), detail: row.format || ''
        })) });
        const mapped = (datasets || []).filter(dataset => Number(dataset.mappable_count) > 0).slice(0, 6);
        if (mapped.length) sections.push({ title: 'Datasets with maps', links: mapped.map(dataset => ({
            path: dataset.preview_map_id
                ? '/resources/' + encodeURIComponent(dataset.preview_map_id) + '?view=map'
                : '/datasets/' + encodeURIComponent(dataset.name || dataset.id),
            label: seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id
        })) });
    }
    const nearby = [
        province ? { ...placeLink(province), detail: 'Province' + (province.kind === 'territory' ? ' or territory' : '') } : null,
        ...(Array.isArray(place.children) ? place.children : []).map(placeLink),
        ...(hub && firstPage ? hub.siblings : []).map(placeLink)
    ].filter(Boolean);
    const guides = ['en', 'fr'].flatMap(lang => listArticles({ lang, place: slug })
        .map(article => ({ path: article.path, label: article.title, detail: lang === 'fr' ? '(français)' : '' })));
    return shell({
        pagination,
        breadcrumbs: [{ label: 'Places', path: '/places' }, ...ancestors.map(ancestor => ({
            label: placeLabel(ancestor), path: '/places/' + encodeURIComponent(ancestor.slug || ancestor.id) })), { label: name }],
        title: name + ' open data',
        lead: placeLead({ name, type, province: province ? placeLabel(province) : '', count, maps, liveTables, levels, publishers }),
        facts: [
            { label: 'Datasets', value: count },
            { label: 'Direct datasets', value: Number(place.direct_dataset_count) || 0 },
            { label: 'With maps', value: maps },
            liveTables ? { label: 'With live tables', value: liveTables } : null,
            publishers ? { label: 'Publishers', value: publishers } : null,
            place.last_modified ? { label: 'Last catalogue update', value: catalogFacts.isoDate(place.last_modified) } : null
        ],
        sections,
        linksTitle: 'Datasets',
        links: datasetLinks,
        relatedTitle: 'Nearby places',
        relatedLinks: nearby,
        guides
    });
}

function organizationSnapshot(organization, datasets, pagination) {
    const name = seo.plainText(organization.title_en) || seo.plainText(organization.title_fr) || organization.name;
    const links = (datasets || []).map(dataset => ({
        path: '/datasets/' + encodeURIComponent(dataset.name || dataset.id),
        label: seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id
    }));
    const relatedLinks = [];
    if (organization.place_id) {
        const placeName = seo.plainText(organization.place_name_en) || seo.plainText(organization.place_name_fr) || organization.place_slug;
        relatedLinks.push({
            path: '/places/' + encodeURIComponent(organization.place_slug || organization.place_id),
            label: placeName + ' open data'
        });
    }
    const total = Number(organization.dataset_count) || 0;
    return shell({
        pagination,
        breadcrumbs: [{ label: 'Organizations', path: '/organizations' }, { label: name }],
        title: name + ' open data',
        lead: seo.organizationMeta(organization, datasets).description,
        facts: [
            { label: 'Datasets', value: total },
            { label: 'Queryable datasets', value: Number(organization.queryable_dataset_count) || 0 },
            { label: 'Mappable datasets', value: Number(organization.mappable_dataset_count) || 0 }
        ],
        linksTitle: 'Datasets',
        links,
        relatedTitle: 'Part of',
        relatedLinks
    });
}

const STATIC_COPY = {
    home: {
        title: 'Search Canadian open data',
        summary: seo.DEFAULT_DESC,
        links: [
            { path: '/datasets', label: 'Browse all datasets' },
            { path: '/places', label: 'Browse open data by place' },
            { path: '/blog', label: 'Read data guides' },
            { path: '/organizations', label: 'Browse publishing organizations' },
            { path: '/insights', label: 'Explore popular dataset insights' },
            { path: '/docs', label: 'Use the CanQuery API' }
        ]
    },
    datasets: {
        title: 'Browse all Canadian datasets',
        summary: 'Browse the complete CanQuery catalogue, including downloadable files, live tables and maps.'
    },
    insights: {
        title: 'Top downloaded Canadian datasets',
        summary: 'Explore live charts built from the most-downloaded datasets in the CanQuery catalogue.',
        links: [{ path: '/', label: 'Search all datasets' }]
    },
    organizations: {
        title: 'Organizations publishing Canadian open data',
        summary: 'Browse public-sector organizations and the datasets they publish through CanQuery.'
    },
    places: {
        title: 'Canadian open data by place',
        summary: 'Browse open datasets for provinces, territories, regions and municipalities across Canada.'
    },
    docs: {
        title: 'CanQuery API documentation',
        summary: 'Build your first Canadian public-data integration with working examples, resource capabilities, typed endpoint reference and practical guidance for limits, pagination and retries.',
        links: [{ path: '/', label: 'Search the catalogue' }]
    },
    privacy: {
        title: 'Privacy and analytics',
        summary: 'Learn about CanQuery product analytics, browser opt-outs, account data, hosting and security processing, and encrypted recovery backups.',
        links: [{ path: '/', label: 'Return to CanQuery' }]
    },
    faq: {
        title: 'Frequently asked questions',
        summary: 'A few useful answers about finding data and preparing tables.',
        links: [
            { path: '/docs', label: 'Read the API documentation' },
            { path: '/privacy', label: 'Privacy and your data' }
        ]
    },
    about: {
        title: 'About CanQuery',
        summary: 'Canadian public data is published across many portals. CanQuery brings those catalogues together so you can search by place or topic, find the original source and work with supported data in one place.',
        links: [
            { path: '/datasets', label: 'Browse the catalogue' },
            { path: '/faq', label: 'Read the FAQ' }
        ]
    }
};

function homeExplanation() {
    const steps = [
        { title: 'Search government datasets',
            summary: 'Find Canadian government datasets by place, topic, publisher and format.' },
        { title: 'Choose a download, table or map',
            summary: 'Download original files, prepare eligible CSV and Excel files as tables, or explore supported maps.' },
        { title: 'Filter, export or use the API',
            summary: 'Filter and sort supported tables, export up to 10,000 rows as CSV, or query data with CanQuery’s free API.' }
    ];
    return '<section><h2>How CanQuery works</h2><ol>' + steps.map(step =>
        '<li><h3>' + text(step.title) + '</h3><p>' + text(step.summary) + '</p></li>'
    ).join('') + '</ol></section>';
}

const ADVERTISING_EXPLANATION = Object.freeze({
    title: 'Advertising',
    summary: 'Public pages show ads from Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites. Google’s use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and other sites on the Internet. You can opt out of personalized advertising in Google’s Ads Settings (https://www.google.com/settings/ads) or opt out of some third-party vendors’ use of cookies for personalized advertising at www.aboutads.info. Do Not Track and Global Privacy Control turn off CanQuery’s analytics but not Google’s ad code. Account and sign-in pages carry no ads.'
});

function privacyExplanation() {
    const sections = [
        { title: 'Product analytics and browser controls',
            summary: 'CanQuery uses cookie-free, self-hosted product analytics. Product analytics do not store raw network addresses. Do Not Track and Global Privacy Control prevent the analytics tracker and heatmap recorder from loading. Account and password pages do not load analytics.' },
        { title: 'Hosting, delivery and security',
            summary: 'CanQuery’s hosting provider and Cloudflare process request information, including network addresses, requested URLs and query parameters, and HTTP headers, to deliver and protect the service. Cloudflare provides the content delivery network and request protection. Browser analytics opt-outs do not prevent this necessary request processing. The product analytics limits above do not describe provider security logs or their retention.' },
        { title: 'Recovery backups',
            summary: 'Encrypted recovery copies of the application and analytics databases and required configuration are stored in private Cloudflare R2 storage. These copies include account and usage records retained by CanQuery. Backup access is restricted, and decryption keys are kept separately from the uploaded copies. Data removed from the live service may remain in a retained backup until that copy expires; backup retention is managed separately from live-service retention.' }
    ];
    // Only a deployment that runs Google AdSense (ADSENSE_CLIENT) discloses it.
    if (adsenseClient()) sections.splice(1, 0, ADVERTISING_EXPLANATION);
    return sections.map(section => '<section><h2>' + text(section.title) + '</h2><p>' + text(section.summary) + '</p></section>').join('');
}

function supportExplanation() {
    return '<section id="support"><h2>Contact support</h2>' +
        '<p>Have a question, found a bug or need account help? Email us at: ' +
        pathLink('mailto:support@canquery.com', 'support@canquery.com') + '</p>' +
        '<p>For a technical issue, include the page or resource URL, what you were trying to do and the error message. If available, include the time, HTTP status and X-Request-Id. Leave out API keys, passwords and sensitive query contents.</p>' +
        '<p>For the first few customers, the founder can help by email with one existing supported resource and one working query. Custom integrations need a separate scope.</p></section>';
}

function aboutExplanation() {
    const sections = [
        { title: 'What is CanQuery?', paragraphs: [
            'CanQuery is a free search engine for Canadian open data. It brings together datasets from federal, provincial, territorial and municipal publishers so you can find them by place or topic, explore supported files as live tables, charts and maps, and follow each one back to its official source.'
        ] },
        { title: 'Find the data. Keep the context.', paragraphs: [
            'CanQuery is for anyone exploring Canadian public data, from curious residents to researchers and developers building reports or dashboards. The website and API help you discover datasets without losing sight of who published them or what they cover.'
        ] },
        { title: 'From public sources to useful tools', paragraphs: [
            'CanQuery mirrors catalogue metadata from Canadian federal, municipal, regional and territorial publishers. You can follow original download links, query supported live tables, prepare eligible CSV and Excel files, and explore supported maps. Availability depends on the resource and its publisher.',
            'Each dataset keeps its publisher, source links and applicable licence. Field meanings and coverage remain publisher-specific. Check the original source and attribution requirements when using the data.'
        ] },
        { title: 'Independently built, openly shared', paragraphs: [
            'CanQuery is an independent project and is not affiliated with the Government of Canada. It is built by @RyuPrad, and its source code is available under the MIT licence. The software licence is separate from the licences that apply to the published data.'
        ] }
    ];
    return sections.map(section => '<section><h2>' + text(section.title) + '</h2>' +
        section.paragraphs.map(paragraph => '<p>' + text(paragraph) + '</p>').join('') + '</section>').join('') +
        '<p>' + pathLink('https://github.com/RyuPrad', 'Meet the creator on GitHub') + ' · ' +
        pathLink('https://github.com/RyuPrad/canquery', 'Explore the source code') + '</p>' + supportExplanation();
}

// hosted adds questions and groups for a deployment with developer accounts.
function faqExplanation(hosted = {}) {
    const groups = [
        { id: 'getting-started', title: 'Getting started', questions: [
            { question: 'What can I do with CanQuery?',
                answer: 'Search Canadian public-data catalogues by topic, place, publisher or format. Follow original downloads, explore supported tables and maps, or use the developer API in your own tools. A catalogue listing does not guarantee that every file is available or can be queried.' },
            { question: 'Where does the data come from, and can I reuse it?',
                answer: 'The data comes from public-sector publishers, including federal, municipal, regional and territorial sources. Dataset pages link to the publisher, source portal and applicable licence. Check that licence and its attribution requirements before reusing the data; different datasets can have different terms.' }
        ] },
        { id: 'working-with-data', title: 'Working with data', questions: [
            { question: 'Why do some resources only offer a download?',
                answer: 'Table and map support depend on the resource. Supported live tables can be queried directly, while eligible CSV and Excel files can be prepared for querying. Other formats, oversized files or unavailable publisher downloads may remain download-only. A resource can support a map without supporting a table.' },
            { question: 'What happens when a file is being prepared?',
                answer: 'When you open an eligible resource in Table or Chart, CanQuery may download the file and prepare a queryable copy. Visitors share existing preparation work. File, row, column and storage limits apply. Opening catalogue pages or Map does not start table preparation.' },
            { question: 'How fresh is a prepared table?',
                answer: 'A prepared table is a snapshot, not a continuously updated feed. CanQuery can refresh an eligible copy on a later visit when tracked source metadata changes. Publisher modification and preparation times are different. Copies may expire after inactivity or be evicted, so check the displayed dates and original source before relying on the data.' },
            { question: 'Can I download the complete dataset?',
                answer: 'Use the original publisher download when you need the source file. CanQuery CSV exports are bounded to at most 10,000 rows and can be subject to a lower installed limit. Filters and aggregation affect the export. An export is not a guarantee of a complete historical dataset.' }
        ] },
        ...(hosted.groups || [])
    ].map(group => {
        const extra = hosted.insert?.[group.id];
        if (!extra) return group;
        const questions = [...group.questions];
        questions.splice(extra.index, 0, ...extra.questions);
        return { ...group, questions };
    });
    return groups.map(group => '<section id="' + text(group.id) + '"><h2>' + text(group.title) + '</h2>' +
        group.questions.map(item => '<details><summary>' + text(item.question) + '</summary><p>' +
            text(item.answer) + '</p></details>').join('') + '</section>').join('') + supportExplanation();
}

function staticSnapshot(type, items = [], pagination) {
    const override = pageOverride(type);
    const route = hostedRoute(type);
    const copy = override?.copy || STATIC_COPY[type] || route?.copy || STATIC_COPY.home;
    const hostedOverview = override?.overview || route?.overview;
    // The places directory is grouped by province or territory in the order
    // the query returns them; places without one (the country) come first.
    const placeSections = [];
    if (type === 'places') {
        const groups = new Map();
        for (const item of items) {
            const title = seo.plainText(item.province_name_en) || seo.plainText(item.province_name_fr) || 'Canada';
            if (!groups.has(title)) groups.set(title, []);
            groups.get(title).push(placeLink(item));
        }
        for (const [title, links] of groups) placeSections.push({ title, links, limit: PAGE_SIZE });
    }
    const dynamicLinks = (type === 'places' ? [] : items).map(item => {
        if (type === 'datasets') return {
            path: '/datasets/' + encodeURIComponent(item.name || item.id),
            label: seo.plainText(item.title_en) || seo.plainText(item.title_fr) || item.name || item.id
        };
        if (type === 'organizations') {
            return {
                path: '/organizations/' + encodeURIComponent(item.name),
                label: seo.plainText(item.title_en) || seo.plainText(item.title_fr) || item.name,
                detail: Number(item.dataset_count || 0).toLocaleString('en-CA') + ' datasets'
            };
        }
        if (type === 'insights') {
            return {
                path: '/datasets/' + encodeURIComponent(item.dataset_name || item.dataset_id),
                label: '#' + item.rank + ' · ' + (seo.plainText(item.title_en) || seo.plainText(item.title_fr) || item.dataset_id),
                detail: Number(item.downloads || 0).toLocaleString('en-CA') + ' downloads'
            };
        }
        return null;
    }).filter(Boolean);
    return shell({
        pagination,
        breadcrumbs: type === 'home' ? [] : [{ label: 'CanQuery', path: '/' }, { label: copy.title }],
        title: copy.title,
        summary: copy.summary,
        overviewHtml: hostedOverview ? hostedOverview()
            : type === 'home' ? homeExplanation()
                : type === 'docs' ? require('./developerPresentation').docsOverview()
                    : type === 'privacy' ? privacyExplanation()
                        : type === 'faq' ? faqExplanation()
                            : type === 'about' ? aboutExplanation() : '',
        guides: type === 'home' ? listArticles({ lang: 'en' }).slice(0, 3).map(article => ({
            path: article.path, label: article.title, detail: article.description
        })) : [],
        sections: placeSections,
        linksTitle: dynamicLinks.length
            ? (type === 'datasets' ? 'Open datasets' : type === 'insights' ? 'Top 100 downloaded datasets' : 'Publishing organizations')
            : 'Explore CanQuery',
        links: dynamicLinks.length || placeSections.length ? dynamicLinks : copy.links,
        linksLimit: type === 'insights' ? 100 : undefined,
        relatedLinks: type === 'insights' && dynamicLinks.length ? copy.links : undefined
    });
}

function errorSnapshot(title, summary) {
    return shell({
        breadcrumbs: [{ label: 'CanQuery', path: '/' }, { label: title }],
        title,
        summary,
        linksTitle: 'Continue',
        links: [{ path: '/', label: 'Return to dataset search' }]
    });
}

module.exports = {
    MAX_LINKS,
    sectionNav,
    safeHttpUrl,
    faqExplanation,
    MAX_SUMMARY,
    datasetSnapshot,
    overviewSnapshot,
    resourceSnapshot,
    placeSnapshot,
    organizationSnapshot,
    staticSnapshot,
    errorSnapshot
};
