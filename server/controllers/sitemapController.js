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

// GET /robots.txt - allow everything, point at the sitemap index. We do NOT
// block /api: Googlebot fetches it while rendering the SPA, and the per-page
// <head> injection plus canonicals keep the index clean.
const robots = (req, res) => {
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send('User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');
};

// GET /sitemap.xml - the index: the static hub pages plus one chunk per slice
// of datasets.
const sitemapIndex = catchAsync(async (req, res) => {
    const total = await catalogRead.countDatasets();
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const locs = [SITE_URL + '/sitemap-pages.xml'];
    for (let i = 1; i <= pages; i++) locs.push(SITE_URL + '/sitemap-datasets-' + i + '.xml');
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
            { loc: SITE_URL + '/docs', changefreq: 'monthly', priority: '0.5' },
        ])
    );
};

// GET /sitemap-datasets-:n.xml - one chunk of dataset URLs.
const sitemapDatasets = catchAsync(async (req, res, next) => {
    const n = parseInt(req.params.n, 10);
    if (!Number.isInteger(n) || n < 1) return next(new AppError('Not found', 404));
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

module.exports = { robots, sitemapIndex, sitemapPages, sitemapDatasets };
