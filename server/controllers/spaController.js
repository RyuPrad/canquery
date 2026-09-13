const fs = require('fs');
const path = require('path');
const seoMeta = require('../services/seoMeta');
const seoSnapshot = require('../services/seoSnapshot');
const { resolveBlogPage } = require('../services/blogPresentation');
const catalogRead = require('../db/catalogReadQueries');
const { PAGE_SIZE, pageNumber, pagePath, pageSlice } = require('../services/catalogPagination');

// The built index.html is immutable for the life of the process (a deploy
// restarts the API), so read it once and reuse.
let templateCache = null;
let templateCacheDir = null;
const ANALYTICS_MARKER = '<!-- analytics:config -->';
const WEBSITE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function loadTemplate(distDir) {
    if (templateCache == null || templateCacheDir !== distDir) {
        templateCache = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
        templateCacheDir = distDir;
    }
    return templateCache;
}

function injectAnalytics(template, websiteId = process.env.ANALYTICS_WEBSITE_ID) {
    if (!template.includes(ANALYTICS_MARKER)) return template;
    const tag = WEBSITE_ID_RE.test(websiteId || '')
        ? '<meta name="canquery-analytics-site" content="' + websiteId + '" />'
        : '';
    return template.replace(ANALYTICS_MARKER, () => tag);
}

const STATIC_PATHS = Object.freeze({
    home: '/', datasets: '/datasets', insights: '/insights', organizations: '/organizations',
    places: '/places', docs: '/docs', privacy: '/privacy'
});

function searchArgs(overrides) {
    return {
        q: null, org: null, format: null, keyword: null, place: null,
        source: null, mappable: null, limit: PAGE_SIZE + 1, offset: 0, ...overrides
    };
}

// Resolve the head, semantic initial body, canonical path and response status
// in one pass. The same HTML is sent to every user agent; React replaces the
// bounded snapshot when the application starts.
function missingPage(path) {
    return { status: 404, meta: seoMeta.notFoundMeta(path),
        body: seoSnapshot.errorSnapshot('Page not found', 'This catalogue page does not exist.') };
}

function paginatedPage(path, meta, rows, page, render) {
    const pagination = pageSlice(rows, page, path);
    if (page > 1 && !pagination.items.length) return missingPage(pagePath(path, page));
    const canonical = seoMeta.SITE_URL + pagePath(path, page);
    const jsonLd = meta.jsonLd?.map(item => item['@type'] === 'CollectionPage' ? {
        ...item, url: canonical,
        mainEntity: { ...item.mainEntity,
            itemListElement: item.mainEntity.itemListElement.map(entry => ({
                ...entry, position: entry.position + (page - 1) * PAGE_SIZE
            })) }
    } : item);
    return { status: 200, canonicalPath: path, paginated: true,
        meta: { ...meta, canonical, ...(jsonLd ? { jsonLd } : {}) },
        body: render(pagination) };
}

async function resolvePage(requestTarget, deps = catalogRead) {
    const [reqPath, ...query] = requestTarget.split('?');
    const params = new URLSearchParams(query.join('?'));
    const blog = resolveBlogPage(reqPath);
    if (blog) return blog;
    const route = seoMeta.classifyRoute(reqPath);
    const paginated = ['dataset', 'datasets', 'organization', 'organizations', 'place', 'places'].includes(route.type);
    const page = paginated ? pageNumber(params) : 1;
    if (page === null) return missingPage(requestTarget);
    const offset = (page - 1) * PAGE_SIZE;
    if (route.type === 'dataset') {
        const dataset = await deps.getDatasetByIdOrName(route.id);
        if (!dataset) return {
            status: 404,
            meta: seoMeta.notFoundMeta(reqPath),
            body: seoSnapshot.errorSnapshot('Dataset not found', 'The requested dataset is not available in the CanQuery catalogue.')
        };
        const resources = await deps.listResourcesForDataset(dataset.id);
        const canonicalPath = '/datasets/' + encodeURIComponent(dataset.name || dataset.id);
        return paginatedPage(canonicalPath, seoMeta.datasetMeta(dataset, resources),
            resources.slice(offset, offset + PAGE_SIZE + 1), page,
            pagination => seoSnapshot.datasetSnapshot(dataset, resources, pagination));
    }
    if (route.type === 'resource') {
        const resource = await deps.getResourceById(route.id);
        if (!resource) return {
            status: 404,
            meta: seoMeta.notFoundMeta(reqPath),
            body: seoSnapshot.errorSnapshot('Resource not found', 'The requested resource is not available in the CanQuery catalogue.')
        };
        const canonicalPath = '/resources/' + encodeURIComponent(resource.id);
        return {
            status: 200,
            canonicalPath,
            meta: seoMeta.resourceMeta(resource),
            body: seoSnapshot.resourceSnapshot(resource)
        };
    }
    if (route.type === 'place') {
        const place = await deps.getPlaceByIdOrSlug(route.id);
        if (!place) return {
            status: 404,
            meta: seoMeta.notFoundMeta(reqPath),
            body: seoSnapshot.errorSnapshot('Place not found', 'The requested place is not available in the CanQuery directory.')
        };
        const datasets = await deps.searchDatasets(searchArgs({ place: place.slug || place.id, offset }));
        const canonicalPath = '/places/' + encodeURIComponent(place.slug || place.id);
        return paginatedPage(canonicalPath, seoMeta.placeMeta(place, datasets), datasets, page,
            pagination => seoSnapshot.placeSnapshot(place, pagination.items, pagination));
    }
    if (route.type === 'organization') {
        const organization = await deps.getOrganizationByName(route.id);
        if (!organization) return {
            status: 404,
            meta: seoMeta.notFoundMeta(reqPath),
            body: seoSnapshot.errorSnapshot('Organization not found', 'The requested organization is not available in the CanQuery directory.')
        };
        const datasets = await deps.searchDatasets(searchArgs({ org: organization.name, offset }));
        const canonicalPath = '/organizations/' + encodeURIComponent(organization.name);
        return paginatedPage(canonicalPath, seoMeta.organizationMeta(organization, datasets), datasets, page,
            pagination => seoSnapshot.organizationSnapshot(organization, pagination.items, pagination));
    }
    if (route.type === 'other') {
        return {
            status: 404,
            meta: seoMeta.notFoundMeta(reqPath),
            body: seoSnapshot.errorSnapshot('Page not found', 'The requested page does not exist on CanQuery.')
        };
    }
    let items = [];
    if (route.type === 'datasets') {
        items = await deps.searchDatasets(searchArgs({ offset }));
    } else if (route.type === 'organizations') {
        items = await deps.listOrganizations({ q: null, source: null, place: null, limit: PAGE_SIZE + 1, offset });
    } else if (route.type === 'places') {
        items = await deps.listPlaces({
            q: null, kind: null, parent: null, featured: true, limit: PAGE_SIZE + 1, offset
        });
    }
    if (paginated) return paginatedPage(STATIC_PATHS[route.type], seoMeta.staticMeta(route.type, reqPath), items, page,
        pagination => seoSnapshot.staticSnapshot(route.type, pagination.items, pagination));
    return {
        status: 200,
        canonicalPath: STATIC_PATHS[route.type],
        meta: seoMeta.staticMeta(route.type, reqPath),
        body: seoSnapshot.staticSnapshot(route.type, items)
    };
}

// Backward-compatible head-only helper retained for tests and callers.
async function resolveMeta(reqPath, deps = catalogRead) {
    return (await resolvePage(reqPath, deps)).meta;
}

function requestPath(req) {
    return req.path || '/';
}

function querySuffix(req) {
    const index = req.originalUrl.indexOf('?');
    return index === -1 ? '' : req.originalUrl.slice(index);
}

// Catch-all SPA handler: inject per-route SEO head and semantic initial body.
// Unknown pages return a real 404; catalogue failures return a retryable 503 so
// crawlers never mistake an outage for valid or missing content.
function serveSpa(distDir) {
    return async (req, res) => {
        const template = loadTemplate(distDir);
        let page;
        try {
            page = await resolvePage(req.originalUrl);
        } catch (err) {
            console.error('SPA page resolution failed:', err.message);
            page = {
                status: 503,
                meta: seoMeta.serviceUnavailableMeta(req.path),
                body: seoSnapshot.errorSnapshot(
                    'Temporarily unavailable',
                    'This CanQuery page could not be loaded. Please try again shortly.'
                )
            };
        }
        const query = new URLSearchParams(querySuffix(req));
        const normalizeFirst = page.paginated && query.get('page') === '1';
        if (page.status === 200 && page.canonicalPath && (requestPath(req) !== page.canonicalPath || normalizeFirst)) {
            let suffix = querySuffix(req);
            if (normalizeFirst) {
                query.delete('page');
                suffix = query.size ? '?' + query.toString() : '';
            }
            res.set('Cache-Control', 'public, max-age=3600');
            return res.redirect(301, page.canonicalPath + suffix);
        }
        let html = seoMeta.renderHtml(template, page.meta, page.body);
        html = injectAnalytics(html);
        res.set('Content-Type', 'text/html; charset=utf-8');
        // HTML is revalidated each load so a new deploy (and its hashed asset
        // refs) propagates immediately; the hashed assets themselves cache for a year.
        res.set('Cache-Control', page.status >= 500
            ? 'no-store'
            : 'public, max-age=0, must-revalidate');
        if (page.status === 503) res.set('Retry-After', '60');
        res.status(page.status).send(html);
    };
}

module.exports = { serveSpa, resolvePage, resolveMeta, loadTemplate, injectAnalytics };
