const express = require('express');
const router = express.Router();
const tableRowsController = require('../controllers/tableRowsController');
const chartsController = require('../controllers/chartsController');
const { tableRowsLimiter, chartsLimiter, customChartLimiter } = require('../middleware/rateLimits');

// Website-only resource routes, mounted on /web-api/v1 alone (app.js). They
// are not developer API operations, so they stay out of the OpenAPI document
// and its route-coverage test, and out of /api/v1 metering.
router.get('/:id/rows', tableRowsLimiter, tableRowsController.getRows);
// The Chart tab: charts chosen and computed by the chart engine, and single
// charts from the custom builder. The app calls these too, so they are not
// limited to the site's own pages.
router.get('/:id/charts', chartsLimiter, chartsController.getCharts);
router.get('/:id/charts/custom', customChartLimiter, chartsController.getCustomChart);

module.exports = router;
