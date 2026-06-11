const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
router.get('/:id', catalogController.getResource);
module.exports = router;
