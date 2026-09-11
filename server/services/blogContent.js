const fs = require('node:fs');
const path = require('node:path');
const MarkdownIt = require('markdown-it');

const ROOT = path.join(__dirname, '../../content/blog');
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
let cache;

function permittedUrl(url) {
    return typeof url === 'string' && !url.includes('\\') && ![...url].some(char => char.charCodeAt(0) <= 32) &&
        (/^https?:\/\/[^/]+/i.test(url) || /^\/(?!\/)/.test(url) || /^#[a-z0-9-]+$/i.test(url));
}

function validateLinks(tokens) {
    for (const token of tokens) {
        if (token.type === 'heading_open' && token.tag === 'h1') throw new Error('Article headings must start at h2');
        if (token.type === 'link_open' && !permittedUrl(token.attrGet('href'))) throw new Error('Unsupported article link');
        if (token.type === 'image' && !/^\/(?!\/)/.test(token.attrGet('src') || '')) throw new Error('Article images must be self-hosted');
        if (token.type === 'image' && !permittedUrl(token.attrGet('src'))) throw new Error('Unsupported article image');
        if (token.children) validateLinks(token.children);
    }
}

function readArticles(root = ROOT) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
    if (!Array.isArray(manifest)) throw new Error('Blog manifest must be an array');
    const ids = new Set();
    const paths = new Set();
    const articles = [];
    for (const entry of manifest) {
        if (!slugPattern.test(entry.id) || ids.has(entry.id)) throw new Error('Duplicate or invalid article id');
        ids.add(entry.id);
        if (!['draft', 'published'].includes(entry.status)) throw new Error('Invalid article status');
        if ((entry.place != null && !slugPattern.test(entry.place)) || !slugPattern.test(entry.topic)) throw new Error('Invalid article place or topic');
        if (!['table', 'map', 'download'].includes(entry.view)) throw new Error('Invalid article view');
        if (entry.datasetId != null && !slugPattern.test(entry.datasetId)) throw new Error('Invalid dataset identity');
        for (const key of ['published', 'updated', 'verified']) {
            if (!datePattern.test(entry[key] || '') || new Date(entry[key]).toISOString().slice(0, 10) !== entry[key]) {
                throw new Error('Invalid article date: ' + key);
            }
        }
        if (entry.updated < entry.published) throw new Error('Article update predates publication');
        for (const lang of ['en', 'fr']) {
            const edition = entry.editions?.[lang];
            if (typeof entry.query?.[lang] !== 'string' || !entry.query[lang].trim()) throw new Error('Missing localized topic query');
            if (!edition || !slugPattern.test(edition.slug) || !edition.title?.trim() ||
                !edition.description?.trim() || (entry.place && !edition.placeName?.trim()) || !edition.topicName?.trim()) {
                throw new Error('Missing or invalid article translation: ' + entry.id + '/' + lang);
            }
            const explore = edition.explore || entry.explore;
            if (!permittedUrl(explore) || !explore.startsWith('/resources/')) throw new Error('Invalid exploration link');
            if (!entry.dataset?.startsWith('/datasets/') || !permittedUrl(entry.dataset)) throw new Error('Invalid dataset link');
            const articlePath = (lang === 'fr' ? '/fr' : '') + '/blog/' + edition.slug;
            if (paths.has(articlePath)) throw new Error('Duplicate article slug');
            paths.add(articlePath);
            // File names derive from validated identities, never request paths.
            const body = fs.readFileSync(path.join(root, entry.id + '.' + lang + '.md'), 'utf8');
            if (!body.trim()) throw new Error('Empty article');
            const tokens = markdown.parse(body, {});
            validateLinks(tokens);
            articles.push({
                id: entry.id, lang, path: articlePath, ...edition,
                place: entry.place, topic: entry.topic, query: entry.query[lang],
                published: entry.published, updated: entry.updated, verified: entry.verified,
                author: 'CanQuery', status: entry.status,
                explore, view: entry.view, dataset: entry.dataset, datasetId: entry.datasetId,
                bodyHtml: markdown.renderer.render(tokens, markdown.options, {}),
                translations: Object.fromEntries(['en', 'fr'].map(language => [language,
                    (language === 'fr' ? '/fr' : '') + '/blog/' + entry.editions[language].slug]))
            });
        }
    }
    return articles;
}

function allArticles() {
    if (!cache) cache = readArticles().filter(article => article.status === 'published');
    return cache;
}

function listArticles({ lang = 'en', place, dataset } = {}) {
    return allArticles().filter(article => article.lang === lang && (!place || article.place === place) &&
        (!dataset || article.datasetId === dataset || article.dataset === '/datasets/' + encodeURIComponent(dataset)))
        .sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id))
        .map(({ bodyHtml: _body, status: _status, ...article }) => article);
}

function getArticle(lang, slug) {
    return allArticles().find(article => article.lang === lang && article.slug === slug) || null;
}

module.exports = { readArticles, listArticles, getArticle, permittedUrl };
