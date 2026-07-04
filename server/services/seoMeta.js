// Pure SEO helpers: route classification, safe HTML/JSON-LD escaping, per-page
// <head> building (title/description/canonical/OpenGraph/Twitter) and
// schema.org JSON-LD (Dataset / WebSite / Organization). No DB, no fs, no
// Express - so it is fully unit-testable and reused by both the SPA head
// injector (controllers/spaController.js) and any other caller.
const { toAbsoluteUrl } = require('../utils/resolveUrl');

const SITE_URL = (process.env.SITE_URL || 'https://canquery.com').replace(/\/+$/, '');
const SITE_NAME = 'canquery';
const DEFAULT_TITLE = "canquery - query Canada's open data";
const DEFAULT_DESC =
    'Search every dataset on open.canada.ca, load CSV and Excel files into live tables, then filter, chart and export them. No signup.';
const DEFAULT_IMAGE = SITE_URL + '/og-image.svg';
const REPO_URL = 'https://github.com/RyuPrad/canquery';

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
        .replace(/&/g, '\\u0026');
    return '<script type="application/ld+json">' + json + '</script>';
}

function collapse(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function truncate(value, max) {
    const s = collapse(value);
    if (s.length <= max) return s;
    return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// English-default site: prefer the EN value, fall back to FR when EN is blank.
function pick(en, fr) {
    return collapse(en) || collapse(fr) || '';
}

function canonicalFor(pathname) {
    let p = pathname || '/';
    const q = p.indexOf('?');
    if (q !== -1) p = p.slice(0, q);
    if (p !== '/') p = p.replace(/\/+$/, '');
    if (!p.startsWith('/')) p = '/' + p;
    return SITE_URL + p;
}

function classifyRoute(pathname) {
    const p = (pathname || '/').replace(/\?.*$/, '');
    if (p === '/' || p === '') return { type: 'home' };
    let m = p.match(/^\/datasets\/([^/]+)\/?$/);
    if (m) return { type: 'dataset', id: decodeURIComponent(m[1]) };
    m = p.match(/^\/resources\/([^/]+)\/?$/);
    if (m) return { type: 'resource', id: decodeURIComponent(m[1]) };
    if (/^\/insights\/?$/.test(p)) return { type: 'insights' };
    if (/^\/organizations\/?$/.test(p)) return { type: 'organizations' };
    if (/^\/docs\/?$/.test(p)) return { type: 'docs' };
    return { type: 'other' };
}

const STATIC_META = {
    home: { title: DEFAULT_TITLE, description: DEFAULT_DESC, path: '/' },
    insights: {
        title: 'Insights: Top 100 downloaded datasets - canquery',
        description:
            'The 100 most-downloaded datasets on open.canada.ca, loaded into canquery and turned into live charts you can explore.',
        path: '/insights',
    },
    organizations: {
        title: 'Organizations - canquery',
        description:
            'Browse the Canadian federal departments and agencies publishing open data, ranked by how many datasets they have.',
        path: '/organizations',
    },
    docs: {
        title: 'API documentation - canquery',
        description:
            'Anonymous JSON API over the mirrored open.canada.ca catalogue: search datasets, load CSV and Excel files, then query them live.',
        path: '/docs',
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
function buildDatasetJsonLd(dataset, resources) {
    const name = pick(dataset.title_en, dataset.title_fr) || 'Dataset';
    const slug = dataset.name || dataset.id;
    const url = SITE_URL + '/datasets/' + encodeURIComponent(slug);
    const description = truncate(pick(dataset.notes_en, dataset.notes_fr) || name, 5000);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name,
        description,
        url,
        identifier: dataset.id,
        isAccessibleForFree: true,
        license: 'https://open.canada.ca/en/open-government-licence-canada',
        sameAs: 'https://open.canada.ca/data/en/dataset/' + dataset.id,
    };
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
        ld.publisher = { '@type': 'Organization', name: 'Government of Canada' };
    }
    const distribution = (resources || [])
        .filter((r) => r && r.url)
        .slice(0, 25)
        .map((r) => {
            const dl = { '@type': 'DataDownload', contentUrl: toAbsoluteUrl(r.url) };
            const fmt = collapse(r.format);
            if (fmt) dl.encodingFormat = fmt;
            const rn = pick(r.name_en, r.name_fr);
            if (rn) dl.name = rn;
            return dl;
        });
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
    const org = pick(dataset.org_title_en, dataset.org_title_fr);
    const notes = pick(dataset.notes_en, dataset.notes_fr);
    const description = truncate(
        notes || (org ? title + ' - open data from ' + org + ', queryable on canquery.' : title),
        300
    );
    const slug = dataset.name || dataset.id;
    return {
        title: title + ' - canquery',
        description,
        canonical: SITE_URL + '/datasets/' + encodeURIComponent(slug),
        ogType: 'website',
        jsonLd: [buildDatasetJsonLd(dataset, resources)],
    };
}

function resourceMeta(resource) {
    const name = pick(resource.name_en, resource.name_fr) || 'Resource';
    const ds = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const fmt = collapse(resource.format);
    const description = truncate(
        (fmt ? fmt + ' resource' : 'Resource') +
            (ds ? ' from the dataset "' + ds + '"' : '') +
            ' - filter, chart and export it live on canquery.',
        300
    );
    return {
        title: name + (ds ? ' - ' + ds : '') + ' - canquery',
        description,
        canonical: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        ogType: 'website',
    };
}

function notFoundMeta(pathname) {
    return {
        title: 'Not found - canquery',
        description: DEFAULT_DESC,
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true,
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
    tags.push('<meta property="og:title" content="' + title + '" />');
    tags.push('<meta property="og:description" content="' + description + '" />');
    tags.push('<meta property="og:type" content="' + ogType + '" />');
    tags.push('<meta property="og:url" content="' + url + '" />');
    tags.push('<meta property="og:site_name" content="canquery" />');
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
function renderHtml(template, meta) {
    const re = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
    if (!re.test(template)) return template;
    const block = buildManagedTags(meta)
        .map((line) => '    ' + line)
        .join('\n');
    // The replacement must be a function: a string replacement interprets
    // $&, $', $` and $$ as substitution patterns, and dataset text can form
    // them (escapeHtml turns "$'000" into "$&#39;000", whose "$&" would
    // re-inject the whole matched block into the page).
    return template.replace(re, () => '<!-- seo:start -->\n' + block + '\n    <!-- seo:end -->');
}

module.exports = {
    SITE_URL,
    SITE_NAME,
    DEFAULT_TITLE,
    DEFAULT_DESC,
    escapeHtml,
    jsonLdScript,
    truncate,
    classifyRoute,
    canonicalFor,
    buildWebsiteJsonLd,
    buildOrganizationJsonLd,
    buildDatasetJsonLd,
    homeMeta,
    staticMeta,
    datasetMeta,
    resourceMeta,
    notFoundMeta,
    buildManagedTags,
    renderHtml,
};
