const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const catalogRead = require('../db/catalogReadQueries');
const { SITE_URL } = require('../services/seoMeta');

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

// GET /robots.txt - allow everything, point at the sitemap index. We do NOT
// block /api: Googlebot fetches it while rendering the SPA, and the per-page
// <head> injection plus canonicals keep the index clean.
const robots = (req, res) => {
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send('User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');
};

// GET /sitemap.xml - the index: static/place pages plus quality-gated dataset
// and interactive-resource chunks.
const sitemapIndex = catchAsync(async (req, res) => {
    const [datasetTotal, resourceTotal] = await Promise.all([
        catalogRead.countSitemapDatasets(),
        catalogRead.countSitemapResources()
    ]);
    const datasetPages = Math.max(1, Math.ceil(datasetTotal / PAGE_SIZE));
    const resourcePages = Math.ceil(resourceTotal / PAGE_SIZE);
    const locs = [SITE_URL + '/sitemap-pages.xml', SITE_URL + '/sitemap-places.xml'];
    for (let i = 1; i <= datasetPages; i++) locs.push(SITE_URL + '/sitemap-datasets-' + i + '.xml');
    for (let i = 1; i <= resourcePages; i++) locs.push(SITE_URL + '/sitemap-resources-' + i + '.xml');
    const body =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        locs.map((u) => '  <sitemap><loc>' + xmlEscape(u) + '</loc></sitemap>').join('\n') +
        '\n</sitemapindex>\n';
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(body);
});

// GET /sitemap-pages.xml - the hub pages (home + the curated sections).
const sitemapPages = (req, res) => {
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(
        urlset([
            { loc: SITE_URL + '/', changefreq: 'daily', priority: '1.0' },
            { loc: SITE_URL + '/insights', changefreq: 'daily', priority: '0.9' },
            { loc: SITE_URL + '/organizations', changefreq: 'weekly', priority: '0.7' },
            { loc: SITE_URL + '/places', changefreq: 'weekly', priority: '0.8' },
            { loc: SITE_URL + '/docs', changefreq: 'monthly', priority: '0.5' },
            { loc: SITE_URL + '/privacy', changefreq: 'yearly', priority: '0.3' },
        ])
    );
};

// GET /sitemap-places.xml - place pages backed by at least one dataset.
const sitemapPlaces = catchAsync(async (req, res) => {
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

// GET /sitemap-datasets-:n.xml - one chunk of dataset URLs.
const sitemapDatasets = catchAsync(async (req, res, next) => {
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

// GET /sitemap-resources-:n.xml - datastore, locally ingested, and mapped
// resource pages only. Loadable/file-only resources remain discoverable through
// their dataset page without expanding the crawl surface.
const sitemapResources = catchAsync(async (req, res, next) => {
    const n = chunkNumber(req.params.n);
    if (n === null) return next(new AppError('Not found', 404));
    const rows = await catalogRead.listResourceSitemap({
        limit: PAGE_SIZE,
        offset: (n - 1) * PAGE_SIZE,
    });
    if (!rows.length) return next(new AppError('Not found', 404));
    const entries = rows.map(resource => ({
        loc: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        lastmod: resource.metadata_modified ? new Date(resource.metadata_modified).toISOString() : null,
        changefreq: 'monthly',
    }));
    res.type('application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(urlset(entries));
});

module.exports = {
    robots,
    sitemapIndex,
    sitemapPages,
    sitemapPlaces,
    sitemapDatasets,
    sitemapResources
};
