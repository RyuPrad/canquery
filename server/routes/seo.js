const express = require('express');
const sitemap = require('../controllers/sitemapController');

// Crawl-facing files served at the site root (not under /api). Mounted in all
// environments so they can be smoke-tested against the dev API directly.
const router = express.Router();

router.get('/robots.txt', sitemap.robots);
router.get('/sitemap.xml', sitemap.sitemapIndex);
router.get('/sitemap-pages.xml', sitemap.sitemapPages);
router.get('/sitemap-datasets-:n.xml', sitemap.sitemapDatasets);

module.exports = router;
