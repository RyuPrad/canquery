const fs = require('fs');
const path = require('path');
const seoMeta = require('../services/seoMeta');
const seoSnapshot = require('../services/seoSnapshot');
const { resolveBlogPage } = require('../services/blogPresentation');
const { injectRouteAssets } = require('../services/routeAssets');
const { resourceInitialData } = require('../services/resourceInitialData');
const { datasetInitialData } = require('../services/datasetInitialData');
const { hostedRoutes, hostedRoute } = require('../extensions');
const catalogRead = require('../db/catalogReadQueries');
const queryLogQueries = require('../db/queryLogQueries');
const catalogFacets = require('../services/catalogFacets');
const catalogReadCache = require('../services/catalogReadCache');
const { loadPlaceHub } = require('../services/placeHub');
const { PAGE_SIZE, pageNumber, pagePath, pageSlice } = require('../services/catalogPagination');
const adsense = require('../services/adsense');

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

// The same template with a nonce placeholder on its scripts and modulepreloads,
// for ad pages (services/adsense.js).
let noncedTemplate = null;
function loadNoncedTemplate(distDir) {
    const template = loadTemplate(distDir);
    if (noncedTemplate?.source !== template) noncedTemplate = { source: template, value: adsense.markTemplateNonces(template) };
    return noncedTemplate.value;
}

// Google AdSense: the account meta on every page when ads are configured, the
// loader and preload nonce only on ad pages. Without ads the marker line goes.
const ADS_MARKER = '<!-- ads:config -->';
function injectAds(template, client, nonce) {
    if (!template.includes(ADS_MARKER)) return template;
    if (!client) return template.replace(/[ \t]*<!-- ads:config -->\r?\n?/, '');
    return template.replace(ADS_MARKER, () => adsense.adsTags(client, nonce));
}

function injectAnalytics(template, websiteId = process.env.ANALYTICS_WEBSITE_ID) {
    if (!template.includes(ANALYTICS_MARKER)) return template;
    const tag = WEBSITE_ID_RE.test(websiteId || '')
        ? '<meta name="canquery-analytics-site" content="' + websiteId + '" />'
        : '';
    return template.replace(ANALYTICS_MARKER, () => tag);
}

// A resource page's initial data (metadata plus the first rows) and a dataset
// page's (its envelope and guide lists) are embedded only for a document
// navigation: the client's RouteHead fetch of a route's HTML (Sec-Fetch-Dest:
// empty), HEAD requests and scripted reads never use it.
// A browser navigation also records the popularity hit the page's first row
// query recorded before; a crawler's fetch sends no Fetch Metadata headers.
const INITIAL_DATA_ID = 'cq-initial';
function wantsInitialData(req) {
    const destination = req.get('sec-fetch-dest');
    return req.method === 'GET' && (!destination || destination === 'document');
}
const isNavigation = req => req.get('sec-fetch-mode') === 'navigate';
// Ads load only into a page a browser tab displays: not RouteHead's fetch of a
// route's head (Sec-Fetch-Dest: empty). HEAD answers with the same headers as GET.
function isDocumentRequest(req) {
    const destination = req.get('sec-fetch-dest');
    return (req.method === 'GET' || req.method === 'HEAD') && (!destination || destination === 'document');
}

function injectInitialData(html, payload) {
    if (!payload) return html;
    const tag = seoMeta.jsonScript(payload, { type: 'application/json', id: INITIAL_DATA_ID });
    return html.includes('</body>') ? html.replace('</body>', () => tag + '\n</body>') : html + tag;
}

const STATIC_PATHS = Object.freeze({
    home: '/', datasets: '/datasets', insights: '/insights', organizations: '/organizations',
    places: '/places', docs: '/docs', privacy: '/privacy', faq: '/faq', about: '/about'
});
const staticPath = type => STATIC_PATHS[type] || hostedRoute(type)?.path;
// Hosted account and sign-in pages stay out of caches and analytics.
const isPrivatePage = pathname => hostedRoutes().some(route => route.private &&
    (pathname === route.path || pathname.startsWith(route.path + '/')));

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

// Later pages get their own title and description ("(page N)") so they never
// duplicate page one's snippet; the CollectionPage follows the canonical URL.
function paginatedPage(path, meta, rows, page, render) {
    const pagination = pageSlice(rows, page, path);
    if (page > 1 && !pagination.items.length) return missingPage(pagePath(path, page));
    const canonical = seoMeta.SITE_URL + pagePath(path, page);
    const paged = seoMeta.pagedMeta(meta, page);
    const jsonLd = paged.jsonLd?.map(item => item['@type'] === 'CollectionPage' ? {
        ...item, url: canonical,
        mainEntity: { ...item.mainEntity,
            itemListElement: item.mainEntity.itemListElement.map(entry => ({
                ...entry, position: entry.position + (page - 1) * PAGE_SIZE
            })) }
    } : item);
    return { status: 200, canonicalPath: path, paginated: true,
        meta: { ...paged, canonical, ...(jsonLd ? { jsonLd } : {}) },
        body: render(pagination) };
}

// A place hub's optional reads come from the same catalogue module as the
// page's, plus the facet counts and query-log popularity that live elsewhere.
// Injected test dependencies are used as they are.
function hubDeps(deps) {
    return deps === catalogRead
        ? { ...catalogRead, datasetFacets: catalogFacets.datasetFacets, listPopularResources: queryLogQueries.listPopularResources }
        : deps;
}

// The Top 100 links give /insights real content before JavaScript runs; when
// they cannot be read the page keeps its static copy instead of failing.
async function topDownloadLinks(deps) {
    if (typeof deps.listTopDownloadLinks !== 'function') return [];
    try {
        return (await catalogReadCache.get('top-download-links', () => deps.listTopDownloadLinks())) || [];
    } catch (err) {
        console.warn('Top downloads unavailable for /insights:', err.message);
        return [];
    }
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
        const meta = seoMeta.datasetMeta(dataset, resources, { page, pageItems: resources.slice(offset, offset + PAGE_SIZE) });
        return { ...paginatedPage(canonicalPath, meta,
            resources.slice(offset, offset + PAGE_SIZE + 1), page,
            pagination => seoSnapshot.datasetSnapshot(dataset, resources, pagination)), datasetRows: { dataset, resources } };
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
            body: seoSnapshot.resourceSnapshot(resource),
            row: resource
        };
    }
    if (route.type === 'place') {
        const place = await deps.getPlaceByIdOrSlug(route.id);
        if (!place) return {
            status: 404,
            meta: seoMeta.notFoundMeta(reqPath),
            body: seoSnapshot.errorSnapshot('Place not found', 'The requested place is not available in the CanQuery directory.')
        };
        const hub = await loadPlaceHub(place, { page, offset, deps: hubDeps(deps) });
        const canonicalPath = '/places/' + encodeURIComponent(place.slug || place.id);
        return paginatedPage(canonicalPath, seoMeta.placeMeta(place, hub.datasets, { facets: hub.facets }), hub.datasets, page,
            pagination => seoSnapshot.placeSnapshot(place, pagination.items, pagination, hub));
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
    } else if (route.type === 'insights') {
        items = await topDownloadLinks(deps);
    } else if (route.type === 'organizations') {
        items = await deps.listOrganizations({ q: null, source: null, place: null, limit: PAGE_SIZE + 1, offset });
    } else if (route.type === 'places') {
        // Every place with open data, not only the curated ones: the same set
        // as the places sitemap, so each hub has a crawlable link.
        items = await deps.listPlaces({
            q: null, kind: null, parent: null, featured: null, limit: PAGE_SIZE + 1, offset
        });
    }
    if (paginated) return paginatedPage(staticPath(route.type), seoMeta.staticMeta(route.type, reqPath), items, page,
        pagination => seoSnapshot.staticSnapshot(route.type, pagination.items, pagination));
    return {
        status: 200,
        canonicalPath: staticPath(route.type),
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
        let initial = null;
        if (page.status === 200 && page.row && wantsInitialData(req)) {
            try {
                initial = await resourceInitialData(page.row,
                    { path: req.originalUrl, params: query, signal: req.signal, log: isNavigation(req) });
            } catch (err) {
                console.warn('Initial resource data skipped:', err.message);
            }
        } else if (page.status === 200 && page.datasetRows && wantsInitialData(req)) {
            try {
                initial = datasetInitialData(page.datasetRows.dataset, page.datasetRows.resources, { path: req.originalUrl });
            } catch (err) {
                console.warn('Initial dataset data skipped:', err.message);
            }
        }
        const privatePage = isPrivatePage(req.path);
        const adsClient = adsense.adsenseClient();
        // Account and sign-in pages, 404s and 503s never carry ads.
        const adPage = Boolean(adsClient) && page.status === 200 && !privatePage && isDocumentRequest(req);
        // The nonce replaces the template's placeholder before any catalogue
        // text joins the page, so page content can never carry it.
        const nonce = adPage ? adsense.createNonce() : null;
        let html = nonce ? loadNoncedTemplate(distDir).split(adsense.NONCE_PLACEHOLDER).join(nonce) : template;
        html = injectAds(html, adsClient, nonce);
        html = seoMeta.renderHtml(html, page.meta, page.body);
        html = injectAnalytics(html,privatePage ? '' : process.env.ANALYTICS_WEBSITE_ID);
        html = injectRouteAssets(html, req.originalUrl, distDir, nonce);
        html = injectInitialData(html, initial);
        res.set('Content-Type', 'text/html; charset=utf-8');
        // HTML is revalidated each load so a new deploy (and its hashed asset
        // refs) propagates immediately; the hashed assets themselves cache for a
        // year. An ad page's nonce must never reach a second visitor from a cache.
        res.set('Cache-Control', privatePage || page.status >= 500
            ? 'no-store'
            : adPage ? 'private, no-cache' : 'public, max-age=0, must-revalidate');
        if (adPage) {
            // One policy replaces helmet's; a second header would intersect with it.
            res.set('Content-Security-Policy', adsense.adPagePolicy(nonce));
            // Google's consent messages need the origin as referrer, and an ad
            // click may open its landing page in a new window.
            res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        }
        if (page.status === 503) res.set('Retry-After', '60');
        res.status(page.status).send(html);
    };
}

module.exports = { serveSpa, resolvePage, resolveMeta, loadTemplate, injectAds, injectAnalytics, injectInitialData, INITIAL_DATA_ID };
