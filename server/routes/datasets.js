const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
router.get('/', catalogController.listDatasets);
router.get('/:idOrName', catalogController.getDataset);
module.exports = router;
