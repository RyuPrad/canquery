const express = require('express');
const catalogController = require('../controllers/catalogController');
const router = express.Router();

router.get('/', catalogController.listPlaces);
router.get('/:idOrSlug', catalogController.getPlace);

module.exports = router;
