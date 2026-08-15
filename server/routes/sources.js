const express = require('express');
const catalogController = require('../controllers/catalogController');
const router = express.Router();

router.get('/', catalogController.listSources);

module.exports = router;
