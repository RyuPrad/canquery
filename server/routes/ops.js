const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
router.get('/', catalogController.getOps);
router.get('/components/:component', require('../controllers/componentHealthController').component);
module.exports = router;
