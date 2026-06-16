// Resource download URLs from the catalogue are sometimes stored relative to the
// open data portal (e.g. "/data/dataset/<id>/resource/<id>/download/file.csv").
// fetch() needs an absolute URL, so resolve relatives against the upstream
// origin. Absolute URLs (including external ones) pass through unchanged.
const UPSTREAM_ORIGIN = (() => {
    try {
        return new URL(process.env.CKAN_BASE_URL || 'https://open.canada.ca/data/api/3/action').origin;
    } catch {
        return 'https://open.canada.ca';
    }
})();

function toAbsoluteUrl(u) {
    if (typeof u !== 'string' || u === '') return u;
    try {
        return new URL(u, UPSTREAM_ORIGIN).href;
    } catch {
        return u;
    }
}

module.exports = { toAbsoluteUrl, UPSTREAM_ORIGIN };
