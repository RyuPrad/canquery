const AppError = require('../utils/AppError');
const { createCache } = require('../utils/cache');
const catalogRead = require('../db/catalogReadQueries');
const { listArticles } = require('../services/blogContent');
const { SITE_URL } = require('../services/seoMeta');
const { hostedRoutes } = require('../extensions');

// Sitemap files cap at 50,000 URLs each; we chunk datasets well under that and
// expose a sitemap index so the catalogue can keep growing.
const PAGE_SIZE = 25000;

function xmlEscape(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
    let s = '  <url>\n    <loc>' + xmlEscape(loc) + '</loc>\n';
    if (lastmod) s += '    <lastmod>' + xmlEscape(lastmod) + '</lastmod>\n';
    if (changefreq) s += '    <changefreq>' + changefreq + '</changefreq>\n';
    if (priority) s += '    <priority>' + priority + '</priority>\n';
    return s + '  </url>';
}

function urlset(entries) {
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        entries.map(urlEntry).join('\n') +
        '\n</urlset>\n'
    );
}

function chunkNumber(value) {
    if (!/^[1-9]\d*$/.test(value || '')) return null;
    const parsed = Number(value);
    const maxChunk = Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE);
    return Number.isSafeInteger(parsed) && parsed <= maxChunk ? parsed : null;
}

// Crawlers fetch the index and every chunk in bursts, and each count or
// lastmod read is a full scan, so they are read once an hour per process.
const sitemapCache = createCache({ name: 'sitemap', ttlMs: 60 * 60 * 1000, negativeTtlMs: 0, maxEntries: 8 });
const catalogueTotals = () => sitemapCache.get('totals', async () => {
    const [datasets, resources] = await Promise.all([catalogRead.countSitemapDatasets(), catalogRead.countSitemapResources()]);
    return { datasets, resources };
});
const catalogueLastmod = () => sitemapCache.get('lastmod', async () => {
    const value = await catalogRead.getCatalogLastModified();
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
});
const blogLastmod = () => ['en', 'fr'].flatMap(lang => listArticles({ lang })).map(article => article.updated).sort().at(-1) || '';
const latest = (...values) => values.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || '';
const resetSitemapCache = () => sitemapCache.clear();

// A crawl file that cannot be built is a temporary condition: tell the crawler
// to retry instead of handing it a JSON error or an empty document.
const crawlFile = handler => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (err) {
        console.error('Sitemap unavailable:', err.message);
        res.status(503).set({ 'Retry-After': '60', 'Cache-Control': 'no-store' }).type('text/plain').send('Temporarily unavailable\n');
    }
};

// GET /robots.txt - allow everything, point at the sitemap index. We do NOT
// block /api reads: Googlebot fetches them while rendering the SPA, and the
// per-page <head> injection and API X-Robots-Tag headers distinguish search
// landing pages. Only the resource writes that start or renew table preparation
// are disallowed, so rendering crawlers do not prepare files nobody reads.
const PREPARATION_WRITES = ['/web-api/v1', '/api/v1'].flatMap(base =>
    ['prepare', 'ingest', 'activity'].map(action => 'Disallow: ' + base + '/resources/*/' + action));
const robots = (req, res) => {
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    // Specific rules precede Allow for crawlers that apply the first matching line.
    res.send('User-agent: *\n' + PREPARATION_WRITES.join('\n') + '\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');
};

// GET /sitemap.xml - the index: hub pages, places, organizations, guides and
// the complete dataset chunks plus the data-bearing resource chunks. Each entry
// carries the newest change it can contain, so a crawler can skip unchanged files.
const sitemapIndex = crawlFile(async (req, res) => {
    const [totals, catalogue] = await Promise.all([catalogueTotals(), catalogueLastmod()]);
    const blog = blogLastmod();
    const datasetPages = Math.max(1, Math.ceil(totals.datasets / PAGE_SIZE));
    const resourcePages = Math.ceil(totals.resources / PAGE_SIZE);
    const entries = [
        ['/sitemap-pages.xml', latest(catalogue, blog)],
        ['/sitemap-places.xml', catalogue],
        ['/sitemap-organizations.xml', catalogue],
        ['/sitemap-blog.xml', blog]
    ];
    for (let i = 1; i <= datasetPages; i++) entries.push(['/sitemap-datasets-' + i + '.xml', catalogue]);
    for (let i = 1; i <= resourcePages; i++) entries.push(['/sitemap-resources-' + i + '.xml', catalogue]);
    const body =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        entries.map(([path, lastmod]) => '  <sitemap><loc>' + xmlEscape(SITE_URL + path) + '</loc>' +
            (lastmod ? '<lastmod>' + xmlEscape(lastmod) + '</lastmod>' : '') + '</sitemap>').join('\n') +
        '\n</sitemapindex>\n';
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(body);
});

// GET /sitemap-pages.xml - the hub pages (home + the curated sections). The
// catalogue hubs change whenever the catalogue does; the documentation pages
// have no honest change date and carry none.
const sitemapPages = crawlFile(async (req, res) => {
    const catalogue = await catalogueLastmod();
    const hub = catalogue ? { lastmod: catalogue } : {};
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(
        urlset([
            { loc: SITE_URL + '/', changefreq: 'daily', priority: '1.0', ...hub },
            { loc: SITE_URL + '/datasets', changefreq: 'daily', priority: '0.9', ...hub },
            { loc: SITE_URL + '/insights', changefreq: 'daily', priority: '0.9', ...hub },
            { loc: SITE_URL + '/organizations', changefreq: 'weekly', priority: '0.7', ...hub },
            { loc: SITE_URL + '/places', changefreq: 'weekly', priority: '0.8', ...hub },
            { loc: SITE_URL + '/docs', changefreq: 'monthly', priority: '0.5' },
            { loc: SITE_URL + '/faq', changefreq: 'monthly', priority: '0.5' },
            { loc: SITE_URL + '/about', changefreq: 'monthly', priority: '0.5' },
            ...hostedRoutes().filter(route => route.sitemap).map(route => ({ loc: SITE_URL + route.path, ...route.sitemap })),
            { loc: SITE_URL + '/privacy', changefreq: 'yearly', priority: '0.3' },
        ])
    );
});

// GET /sitemap-places.xml - place pages backed by at least one dataset.
const sitemapPlaces = crawlFile(async (req, res) => {
    const rows = await catalogRead.listPlaceSitemap();
    const entries = rows.map(place => ({
        loc: SITE_URL + '/places/' + encodeURIComponent(place.slug),
        lastmod: place.metadata_modified ? new Date(place.metadata_modified).toISOString() : null,
        changefreq: 'weekly'
    }));
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(urlset(entries));
});

// GET /sitemap-organizations.xml - public organizations with at least one
// mirrored dataset. Their detail pages are useful discovery hubs even when a
// particular dataset is download-only.
const sitemapOrganizations = crawlFile(async (req, res) => {
    const rows = await catalogRead.listOrganizationSitemap();
    const entries = rows.map(organization => ({
        loc: SITE_URL + '/organizations/' + encodeURIComponent(organization.name),
        lastmod: organization.metadata_modified
            ? new Date(organization.metadata_modified).toISOString()
            : null,
        changefreq: 'weekly'
    }));
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(urlset(entries));
});

// GET /sitemap-datasets-:n.xml - one chunk of dataset URLs.
const sitemapDatasets = crawlFile(async (req, res, next) => {
    const n = chunkNumber(req.params.n);
    if (n === null) return next(new AppError('Not found', 404));
    const rows = await catalogRead.listDatasetSitemap({
        limit: PAGE_SIZE,
        offset: (n - 1) * PAGE_SIZE,
    });
    if (!rows.length) return next(new AppError('Not found', 404));
    const entries = rows.map((d) => ({
        loc: SITE_URL + '/datasets/' + encodeURIComponent(d.name || d.id),
        lastmod: d.metadata_modified ? new Date(d.metadata_modified).toISOString() : null,
        changefreq: 'monthly',
    }));
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(urlset(entries));
});

// GET /sitemap-resources-:n.xml - the data-bearing resource detail pages.
const sitemapResources = crawlFile(async (req, res, next) => {
    const n = chunkNumber(req.params.n);
    if (n === null) return next(new AppError('Not found', 404));
    const rows = await catalogRead.listResourceSitemap({
        limit: PAGE_SIZE,
        offset: (n - 1) * PAGE_SIZE,
    });
    if (!rows.length) return next(new AppError('Not found', 404));
    const entries = rows.map(resource => ({
        loc: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        lastmod: resource.lastmod ? new Date(resource.lastmod).toISOString() : null,
        changefreq: 'monthly',
    }));
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(urlset(entries));
});

const sitemapBlog = (req, res) => {
    const articles = ['en', 'fr'].flatMap(lang => listArticles({ lang }));
    const updated = articles.map(article => article.updated).sort().at(-1);
    const entries = ['/blog', '/fr/blog'].map(path => ({ loc: SITE_URL + path, lastmod: updated }));
    for (const article of articles) entries.push({ loc: SITE_URL + article.path, lastmod: article.updated });
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(urlset(entries));
};

module.exports = {
    resetSitemapCache,
    sitemapBlog,
    robots,
    sitemapIndex,
    sitemapPages,
    sitemapPlaces,
    sitemapOrganizations,
    sitemapDatasets,
    sitemapResources
};
