const express = require('express');
const sitemap = require('../controllers/sitemapController');
const { adsTxt } = require('../services/adsense');
const { keyFile } = require('../services/indexNow');

// Crawl-facing files served at the site root (not under /api). Mounted in all
// environments so they can be smoke-tested against the dev API directly.
const router = express.Router();

router.get('/robots.txt', sitemap.robots);
router.get('/ads.txt', adsTxt);
router.get('/sitemap.xml', sitemap.sitemapIndex);
router.get('/sitemap-blog.xml', sitemap.sitemapBlog);
router.get('/sitemap-pages.xml', sitemap.sitemapPages);
router.get('/sitemap-places.xml', sitemap.sitemapPlaces);
router.get('/sitemap-organizations.xml', sitemap.sitemapOrganizations);
router.get('/sitemap-datasets-:n.xml', sitemap.sitemapDatasets);
router.get('/sitemap-resources-:n.xml', sitemap.sitemapResources);
// IndexNow's key file, only when INDEXNOW_KEY is set; any other .txt falls through.
router.get('/:key.txt', keyFile);

module.exports = router;
