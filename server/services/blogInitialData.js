const { getArticle, listArticles } = require('./blogContent');
const { envelope } = require('../utils/envelope');

// A direct visit to a guide receives, inside its HTML, the article envelope and
// its language's guide list (for the related guides) that the page would
// otherwise fetch; a guide index receives the list. The page then draws the
// article it was sent with on its first render, with no loading state between
// the server HTML and the application, so a reader who arrives at a passage (a
// #fragment, or the text fragment of a search result or an AI Overview
// citation) stays at it. Built from the manifest alone: no catalogue query.
const INLINE_MAX_BYTES = 256 * 1024;
const PAYLOAD_VERSION = 1;

function blogInitialData({ lang, slug }, { path }) {
    const guides = envelope(listArticles({ lang }));
    let payload;
    if (slug) {
        const article = getArticle(lang, slug);
        if (!article) return null;
        payload = { version: PAYLOAD_VERSION, kind: 'guide', path, lang, article: envelope(article), guides };
    } else {
        payload = { version: PAYLOAD_VERSION, kind: 'guides', path, lang, guides };
    }
    return Buffer.byteLength(JSON.stringify(payload)) > INLINE_MAX_BYTES ? null : payload;
}

module.exports = { blogInitialData, INLINE_MAX_BYTES, PAYLOAD_VERSION };
