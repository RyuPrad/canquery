const { listArticles } = require('./blogContent');
const { SITE_URL } = require('./seoMeta');

// IndexNow (Bing, Yandex, Seznam, Naver and others): once a day the job sends
// the canonical URLs whose sitemap entry changed. Off unless INDEXNOW_KEY is
// set. The key is served at /<key>.txt, which proves the site owns it; a
// malformed value stops startup (app.js) instead of quietly sending nothing.
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const PROGRESS_KEY = 'indexnow';
// IndexNow accepts up to 10,000 URLs per request.
const BATCH_SIZE = 10000;
const MAX_BATCHES = 5;
// Municipal sources sync once a day, with publisher change times up to a day
// old, so each run looks one day further back than where the last one ended.
const OVERLAP_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

function indexNowKey(value = process.env.INDEXNOW_KEY) {
    const key = (value || '').trim();
    if (!key) return null;
    if (!KEY_RE.test(key)) throw new Error('INDEXNOW_KEY must be 8 to 128 letters, digits or hyphens');
    return key;
}

// GET /:key.txt - the key file IndexNow fetches to verify a submission.
function keyFile(req, res, next) {
    const key = indexNowKey();
    if (!key || req.params.key !== key) return next();
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(key);
}

// Guides carry a date, not a time: one updated on the day the window starts
// is included.
function changedGuidePaths(since) {
    const day = since.toISOString().slice(0, 10);
    const articles = ['en', 'fr'].flatMap(lang => listArticles({ lang })).filter(article => article.updated >= day);
    const indexes = [...new Set(articles.map(article => article.lang === 'fr' ? '/fr/blog' : '/blog'))];
    return [...indexes, ...articles.map(article => article.path)];
}

function changedUrls({ datasets, resources }, since) {
    return [...new Set([
        ...datasets.map(row => SITE_URL + '/datasets/' + encodeURIComponent(row.name || row.id)),
        ...resources.map(row => SITE_URL + '/resources/' + encodeURIComponent(row.id)),
        ...changedGuidePaths(since).map(path => SITE_URL + path)
    ])];
}

// One run: read the window, collect its URLs, send them in batches and move
// the watermark only after every batch was accepted (200 or 202).
async function submitChanges({ key, readProgress, writeProgress, readChanges, fetchImpl = fetch,
    now = new Date(), dryRun = false, log = console.log }) {
    const progress = await readProgress();
    const through = progress && progress.submitted_through ? new Date(progress.submitted_through) : null;
    const since = through && !Number.isNaN(through.getTime())
        ? new Date(Math.min(through.getTime(), now.getTime()) - OVERLAP_MS)
        : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
    const limit = BATCH_SIZE * MAX_BATCHES;
    const changes = await readChanges({ since, until: now, limit: limit + 1 });
    const urls = changedUrls(changes, since);
    if (changes.datasets.length > limit || changes.resources.length > limit || urls.length > limit) {
        throw new Error('more than ' + limit + ' changed URLs since ' + since.toISOString() + '; not submitting');
    }
    const summary = { since: since.toISOString(), until: now.toISOString(), urls: urls.length,
        datasets: changes.datasets.length, resources: changes.resources.length };
    if (dryRun) {
        log('would submit ' + urls.length + ' URLs changed since ' + summary.since + ' (dry-run): ' + urls.slice(0, 5).join(' '));
        return { ...summary, submitted: 0 };
    }
    const host = new URL(SITE_URL).host;
    for (let start = 0; start < urls.length; start += BATCH_SIZE) {
        const response = await fetchImpl(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ host, key, keyLocation: SITE_URL + '/' + key + '.txt',
                urlList: urls.slice(start, start + BATCH_SIZE) })
        });
        if (response.status !== 200 && response.status !== 202) {
            throw new Error('IndexNow answered HTTP ' + response.status + ' for ' + Math.min(BATCH_SIZE, urls.length - start) + ' URLs');
        }
    }
    await writeProgress({ submitted_through: now.toISOString(), urls: urls.length });
    log('submitted ' + urls.length + ' URLs changed since ' + summary.since);
    return { ...summary, submitted: urls.length };
}

module.exports = { indexNowKey, keyFile, submitChanges, changedUrls, ENDPOINT, PROGRESS_KEY, BATCH_SIZE, MAX_BATCHES, OVERLAP_MS };
