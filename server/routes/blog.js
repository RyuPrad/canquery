const express = require('express');
const { listArticles, getArticle } = require('../services/blogContent');
const { envelope } = require('../utils/envelope');
const AppError = require('../utils/AppError');
const router = express.Router();

router.get('/', (req, res, next) => {
    const lang = req.query.lang || 'en';
    if (!['en', 'fr'].includes(lang) || (req.query.place != null && typeof req.query.place !== 'string')) {
        return next(new AppError('Invalid blog filter', 400));
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(listArticles({ lang, place: req.query.place })));
});

router.get('/:lang/:slug', (req, res, next) => {
    const article = getArticle(req.params.lang, req.params.slug);
    if (!article) return next(new AppError('Article not found', 404));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(article));
});

module.exports = router;
