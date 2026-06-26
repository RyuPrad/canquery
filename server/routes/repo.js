const express = require('express');
const router = express.Router();
const repoController = require('../controllers/repoController');
router.get('/', repoController.getRepo);
module.exports = router;
