const express = require('express');
const router = express.Router();
const insightsController = require('../controllers/insightsController');

router.get('/top-downloads', insightsController.getTopDownloads);
router.get('/featured', insightsController.getFeatured);

module.exports = router;
