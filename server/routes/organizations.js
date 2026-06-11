const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
router.get('/', catalogController.listOrganizations);
module.exports = router;
