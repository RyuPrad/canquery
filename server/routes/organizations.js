const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
router.get('/', catalogController.listOrganizations);
router.get('/:name', catalogController.getOrganization);
module.exports = router;
