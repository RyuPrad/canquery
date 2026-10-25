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

const isoDate = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
};
const latest = (...values) => values.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || '';

// Crawlers fetch the index and every chunk in bursts, and each count or
// lastmod read is a full scan, so they are read once an hour per process.
const sitemapCache = createCache({ name: 'sitemap', ttlMs: 60 * 60 * 1000, negativeTtlMs: 0, maxEntries: 16 });
const catalogueTotals = () => sitemapCache.get('totals', async () => {
    const [datasets, resources] = await Promise.all([catalogRead.countSitemapDatasets(), catalogRead.countSitemapResources()]);
    return { datasets, resources };
});
const catalogueLastmod = () => sitemapCache.get('lastmod', async () => isoDate(await catalogRead.getCatalogLastModified()));
// The newest change inside each dataset or resource chunk, by chunk number.
const chunkLastmods = family => sitemapCache.get('chunks:' + family, async () => {
    const rows = await (family === 'datasets'
        ? catalogRead.listDatasetSitemapChunkLastmods(PAGE_SIZE)
        : catalogRead.listResourceSitemapChunkLastmods(PAGE_SIZE));
    return new Map(rows.map(row => [Number(row.chunk), isoDate(row.lastmod)]));
});
// The place and organization files and their index dates share one read.
const placeRows = () => sitemapCache.get('places', () => catalogRead.listPlaceSitemap());
const organizationRows = () => sitemapCache.get('organizations', () => catalogRead.listOrganizationSitemap());
const newestRow = rows => latest(...rows.map(row => isoDate(row.metadata_modified)));
const blogLastmod = () => ['en', 'fr'].flatMap(lang => listArticles({ lang })).map(article => article.updated).sort().at(-1) || '';

// Each file is built once an hour per process and then served from memory: a
// resource chunk filters and joins every file row (seconds of work), and
// crawlers fetch the index and its chunks in bursts. A chunk past the end
// builds null and is not kept.
const fileCache = createCache({ name: 'sitemap-file', ttlMs: 60 * 60 * 1000, negativeTtlMs: 0, maxEntries: 64,
    cacheable: body => typeof body === 'string' });
const resetSitemapCache = () => {
    sitemapCache.clear();
    fileCache.clear();
};
const sendXml = (res, body, maxAge) => {
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=' + maxAge);
    res.send(body);
};

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
// block the API reads a page renders from: Googlebot fetches them while
// rendering the SPA, and the per-page <head> injection and API X-Robots-Tag
// headers distinguish search landing pages. The resource writes that start or
// renew table preparation are disallowed, so rendering crawlers do not prepare
// files nobody reads, and so are the render extras below.
const PREPARATION_WRITES = ['/web-api/v1', '/api/v1'].flatMap(base =>
    ['prepare', 'ingest', 'activity'].map(action => 'Disallow: ' + base + '/resources/*/' + action));
// Requests a rendering crawler makes that carry no page content: the analytics
// beacon and the footer's GitHub star count, which falls back to a plain link.
// Search Console's crawl stats showed them among Googlebot's JSON fetches.
const RENDER_EXTRAS = ['/api/send', '/web-api/v1/repo', '/api/v1/repo'].map(path => 'Disallow: ' + path);
const robots = (req, res) => {
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    // Specific rules precede Allow for crawlers that apply the first matching line.
    res.send('User-agent: *\n' + [...PREPARATION_WRITES, ...RENDER_EXTRAS].join('\n') +
        '\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');
};

// GET /sitemap.xml - the index: hub pages, places, organizations, guides and
// the complete dataset chunks plus the data-bearing resource chunks. Each entry
// carries the newest change its file holds, so a crawler can skip unchanged files.
const sitemapIndex = crawlFile(async (req, res) => {
    const body = await fileCache.get('index', async () => {
        const [totals, catalogue, datasetChunks, resourceChunks, places, organizations] = await Promise.all([
            catalogueTotals(), catalogueLastmod(), chunkLastmods('datasets'), chunkLastmods('resources'),
            placeRows(), organizationRows()
        ]);
        const blog = blogLastmod();
        const datasetPages = Math.max(1, Math.ceil(totals.datasets / PAGE_SIZE));
        const resourcePages = Math.ceil(totals.resources / PAGE_SIZE);
        const entries = [
            ['/sitemap-pages.xml', latest(catalogue, blog)],
            ['/sitemap-places.xml', newestRow(places)],
            ['/sitemap-organizations.xml', newestRow(organizations)],
            ['/sitemap-blog.xml', blog]
        ];
        for (let i = 1; i <= datasetPages; i++) entries.push(['/sitemap-datasets-' + i + '.xml', datasetChunks.get(i) || '']);
        for (let i = 1; i <= resourcePages; i++) entries.push(['/sitemap-resources-' + i + '.xml', resourceChunks.get(i) || '']);
        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            entries.map(([path, lastmod]) => '  <sitemap><loc>' + xmlEscape(SITE_URL + path) + '</loc>' +
                (lastmod ? '<lastmod>' + xmlEscape(lastmod) + '</lastmod>' : '') + '</sitemap>').join('\n') +
            '\n</sitemapindex>\n';
    });
    sendXml(res, body, 3600);
});

// GET /sitemap-pages.xml - the hub pages (home + the curated sections). The
// catalogue hubs change whenever the catalogue does; the documentation pages
// have no honest change date and carry none.
const sitemapPages = crawlFile(async (req, res) => {
    const body = await fileCache.get('pages', async () => {
        const catalogue = await catalogueLastmod();
        const hub = catalogue ? { lastmod: catalogue } : {};
        return urlset([
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
        ]);
    });
    sendXml(res, body, 86400);
});

// GET /sitemap-places.xml - place pages backed by at least one dataset.
const sitemapPlaces = crawlFile(async (req, res) => {
    const body = await fileCache.get('places', async () => urlset((await placeRows()).map(place => ({
        loc: SITE_URL + '/places/' + encodeURIComponent(place.slug),
        lastmod: isoDate(place.metadata_modified) || null,
        changefreq: 'weekly'
    }))));
    sendXml(res, body, 3600);
});

// GET /sitemap-organizations.xml - public organizations with at least one
// mirrored dataset. Their detail pages are useful discovery hubs even when a
// particular dataset is download-only.
const sitemapOrganizations = crawlFile(async (req, res) => {
    const body = await fileCache.get('organizations', async () => urlset((await organizationRows()).map(organization => ({
        loc: SITE_URL + '/organizations/' + encodeURIComponent(organization.name),
        lastmod: isoDate(organization.metadata_modified) || null,
        changefreq: 'weekly'
    }))));
    sendXml(res, body, 3600);
});

// GET /sitemap-datasets-:n.xml - one chunk of dataset URLs.
const sitemapDatasets = crawlFile(async (req, res, next) => {
    const n = chunkNumber(req.params.n);
    if (n === null) return next(new AppError('Not found', 404));
    const body = await fileCache.get('datasets-' + n, async () => {
        const rows = await catalogRead.listDatasetSitemap({
            limit: PAGE_SIZE,
            offset: (n - 1) * PAGE_SIZE,
        });
        return rows.length ? urlset(rows.map((d) => ({
            loc: SITE_URL + '/datasets/' + encodeURIComponent(d.name || d.id),
            lastmod: isoDate(d.metadata_modified) || null,
            changefreq: 'monthly',
        }))) : null;
    });
    if (body === null) return next(new AppError('Not found', 404));
    sendXml(res, body, 3600);
});

// GET /sitemap-resources-:n.xml - the data-bearing resource detail pages.
const sitemapResources = crawlFile(async (req, res, next) => {
    const n = chunkNumber(req.params.n);
    if (n === null) return next(new AppError('Not found', 404));
    const body = await fileCache.get('resources-' + n, async () => {
        const rows = await catalogRead.listResourceSitemap({
            limit: PAGE_SIZE,
            offset: (n - 1) * PAGE_SIZE,
        });
        return rows.length ? urlset(rows.map(resource => ({
            loc: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
            lastmod: isoDate(resource.lastmod) || null,
            changefreq: 'monthly',
        }))) : null;
    });
    if (body === null) return next(new AppError('Not found', 404));
    sendXml(res, body, 3600);
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
