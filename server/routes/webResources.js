const express = require('express');
const router = express.Router();
const tableRowsController = require('../controllers/tableRowsController');
const { tableRowsLimiter } = require('../middleware/rateLimits');

// Website-only resource routes, mounted on /web-api/v1 alone (app.js). They
// are not developer API operations, so they stay out of the OpenAPI document
// and its route-coverage test, and out of /api/v1 metering.
router.get('/:id/rows', tableRowsLimiter, tableRowsController.getRows);

module.exports = router;
