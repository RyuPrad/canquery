const { readArticles } = require('../services/blogContent');
const articles = readArticles();
console.log('Validated ' + articles.length + ' article editions (' + new Set(articles.map(article => article.id)).size + ' guides).');
