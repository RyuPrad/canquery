const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
const queryController = require('../controllers/queryController');
router.get('/:id', catalogController.getResource);
router.get('/:id/query', queryController.queryResource);
module.exports = router;
