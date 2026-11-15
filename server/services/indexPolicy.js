// Which catalogue pages a search engine may index. A dataset or file page
// repeats its publisher's record, so it is indexable only when CanQuery adds
// something a reader can use on the page itself: a table it can query now.
// Everything else stays reachable and carries noindex, follow.
//
// The same rule is written in SQL for the sitemaps and IndexNow
// (db/catalogSqlFragments.js: INDEXABLE_RESOURCE and indexableDataset); tests
// keep the two in step. No database, no Express.
const blogContent = require('./blogContent');
const { hubDatasetIds } = require('../utils/datasetHubs');

// A live DataStore table, or a prepared copy that is pinned. An unpinned copy
// appears when any visitor opens a file and is evicted after a day without
// use, so counting it would move pages in and out of the index.
const isIndexableResource = (row = {}) =>
    Boolean(row.datastore_active) || (row.ingest_status === 'ready' && Boolean(row.pinned));

// Datasets a published guide is about, and datasets with a hub of their own:
// CanQuery has written about them, whatever their files offer today.
function alwaysIndexableDatasetIds() {
    const guides = blogContent.listArticles({ lang: 'en' }).map(article => article.datasetId).filter(Boolean);
    return [...new Set([...guides, ...hubDatasetIds()])].sort();
}

const isIndexableDataset = (dataset = {}, resources = []) =>
    alwaysIndexableDatasetIds().includes(dataset.id) || resources.some(isIndexableResource);

// When this policy turned pages noindex. Recrawl sitemaps date those pages by
// it, so crawlers fetch them again and let them go. The date must not be
// earlier than the release that carries the policy: until it has passed, the
// sitemaps date the pages by the time they are built (the SQL clamps to now).
// INDEX_POLICY_SINCE overrides it, for a release on another day or another
// deployment; a malformed value stops startup (app.js).
const POLICY_SINCE = '2026-11-16T07:59:59Z';
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function policySince(value = process.env.INDEX_POLICY_SINCE) {
    const text = (value || '').trim();
    if (!text) return POLICY_SINCE;
    // A date that does not exist (November 31) parses by rolling over; PostgreSQL
    // would refuse it in every recrawl read, so it is refused here.
    const time = INSTANT_RE.test(text) ? Date.parse(text) : NaN;
    if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 19) !== text.slice(0, 19)) {
        throw new Error('INDEX_POLICY_SINCE must be a UTC time such as 2026-11-16T07:59:59Z');
    }
    return text;
}
// How long every page the policy turned noindex stays in the recrawl sitemaps.
const POLICY_RECRAWL_DAYS = 90;

module.exports = { isIndexableResource, alwaysIndexableDatasetIds, isIndexableDataset, policySince, POLICY_SINCE, POLICY_RECRAWL_DAYS };
