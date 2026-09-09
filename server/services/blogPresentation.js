const { listArticles, getArticle } = require('./blogContent');
const { SITE_URL, escapeHtml: esc, truncate } = require('./seoMeta');

const LABELS = {
    en: { title: 'Local guides', intro: 'Practical ways to explore your city with official open data.',
        source: 'View the source dataset', explore: 'Explore the data', city: 'More data for',
        published: 'Published', updated: 'Article updated', verified: 'Data links checked', by: 'By',
        missing: 'Guide not found' },
    fr: { title: 'Guides locaux', intro: 'Des façons pratiques de découvrir votre ville grâce aux données ouvertes officielles.',
        source: 'Consulter le jeu de données source', explore: 'Explorer les données', city: 'Autres données pour',
        published: 'Publié le', updated: 'Article mis à jour le', verified: 'Liens vérifiés le', by: 'Par',
        missing: 'Guide introuvable' }
};

function resolveBlogPage(pathname) {
    const match = /^\/(fr\/)?blog(?:\/([^/]+))?\/?$/.exec(pathname);
    if (!match) return null;
    const lang = match[1] ? 'fr' : 'en';
    const labels = LABELS[lang];
    const indexPath = (lang === 'fr' ? '/fr' : '') + '/blog';
    const article = match[2] ? getArticle(lang, match[2]) : null;
    if (match[2] && !article) return {
        status: 404,
        meta: { title: labels.missing + ' - CanQuery', lang, noindex: true, canonical: SITE_URL + pathname },
        body: '<main class="max-w-3xl mx-auto px-4 py-12"><h1>' + labels.missing + '</h1></main>'
    };
    const canonicalPath = article ? article.path : indexPath;
    const translations = article?.translations || { en: '/blog', fr: '/fr/blog' };
    const title = article?.title || labels.title;
    const description = article?.description || labels.intro;
    const breadcrumbs = [{ '@type': 'ListItem', position: 1, name: labels.title, item: SITE_URL + indexPath }];
    if (article) breadcrumbs.push({ '@type': 'ListItem', position: 2, name: title, item: SITE_URL + article.path });
    const meta = {
        title: truncate(title, 69) + ' - CanQuery', description: truncate(description, 160),
        canonical: SITE_URL + canonicalPath, lang, ogType: article ? 'article' : 'website',
        alternates: { 'en-CA': SITE_URL + translations.en, 'fr-CA': SITE_URL + translations.fr,
            'x-default': SITE_URL + translations.en },
        jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: breadcrumbs }]
    };
    if (article) meta.jsonLd.push({
        '@context': 'https://schema.org', '@type': 'BlogPosting', headline: article.title,
        description: article.description, inLanguage: lang === 'fr' ? 'fr-CA' : 'en-CA',
        datePublished: article.published, dateModified: article.updated,
        author: { '@type': 'Organization', name: 'CanQuery', url: SITE_URL + '/' },
        publisher: { '@type': 'Organization', name: 'CanQuery', url: SITE_URL + '/' },
        mainEntityOfPage: SITE_URL + article.path
    });
    const alternate = lang === 'fr' ? 'en' : 'fr';
    const languageLink = '<a href="' + translations[alternate] + '" hreflang="' + alternate +
        '" class="link">' + (alternate === 'fr' ? 'Lire en français' : 'Read in English') + '</a>';
    let body = '<main data-cq-blog class="max-w-3xl mx-auto px-4 py-10">';
    if (article) {
        body += '<nav aria-label="' + (lang === 'fr' ? 'Fil d’Ariane' : 'Breadcrumbs') + '"><a class="link" href="' + indexPath + '">' + labels.title + '</a></nav>' +
            '<article><p class="cq-chip mt-6">' + esc(article.placeName) + ' · ' + esc(article.topicName) + '</p>' +
            '<h1 class="font-display text-3xl sm:text-4xl font-bold mt-4">' + esc(title) + '</h1>' +
            '<p class="text-base-content/60 mt-4">' + esc(description) + '</p>' +
            '<p class="text-sm text-base-content/60 mt-4">' + labels.by + ' CanQuery · ' + labels.published + ' ' + article.published + '</p>' +
            '<p class="text-sm text-base-content/60">' + labels.updated + ' ' + article.updated + ' · ' + labels.verified + ' ' + article.verified + '</p>' +
            '<p class="mt-4">' + languageLink + '</p>' +
            '<div class="cq-article mt-8">' + article.bodyHtml + '</div>' +
            '<p class="mt-8"><a class="btn btn-primary" href="' + esc(article.explore) + '">' + labels.explore + '</a></p>' +
            '<p class="mt-4"><a class="link" href="' + article.dataset + '">' + labels.source + '</a></p>' +
            '<p class="mt-4"><a class="link" href="/places/' + article.place + '">' + labels.city + ' ' + esc(article.placeName) + '</a></p></article>';
    } else {
        body += '<h1 class="font-display text-4xl font-bold">' + title + '</h1><p class="mt-4">' + description + '</p>' +
            '<p class="mt-4">' + languageLink + '</p><div class="space-y-5 mt-8">' +
            listArticles({ lang }).map(item => '<article class="cq-card p-6"><p class="cq-chip">' + esc(item.placeName) +
                '</p><h2 class="text-xl font-semibold mt-3"><a href="' + item.path + '">' + esc(item.title) +
                '</a></h2><p class="mt-3">' + esc(item.description) + '</p></article>').join('') + '</div>';
    }
    return { status: 200, canonicalPath, meta, body: body + '</main>' };
}

module.exports = { resolveBlogPage };
