const express = require('express');
const router = express.Router();
const ingestController = require('../controllers/ingestController');
router.get('/:id', ingestController.getJob);
module.exports = router;
