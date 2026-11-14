const express = require('express');
const router = express.Router();
const insightsController = require('../controllers/insightsController');

// Website-only insights routes, mounted on /web-api/v1/insights alone (app.js):
// the chart cards of the homepage and the Insights gallery. Not a developer API
// operation, so they stay out of the OpenAPI document and of /api/v1 metering;
// other paths fall through to the shared insights router.
router.get('/charts', insightsController.getChartCards);

module.exports = router;
