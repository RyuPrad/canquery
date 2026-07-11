const DEFAULT_PAGE_SIZE = 100;
// One thousand 100-row pages exceeds the entire current catalogue, so a normal
// catch-up reaches its watermark instead of repeatedly wedging on the same
// truncated newest prefix. The cap remains as a malformed/upstream guard.
const DEFAULT_MAX_PAGES = 1000;
const DEFAULT_OVERLAP_MS = 5 * 60 * 1000;

function timestampMs(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function latestTimestamp(first, second) {
    const firstMs = timestampMs(first);
    const secondMs = timestampMs(second);
    if (firstMs === null) return secondMs === null ? null : new Date(secondMs).toISOString();
    if (secondMs === null || firstMs >= secondMs) return new Date(firstMs).toISOString();
    return new Date(secondMs).toISOString();
}

// CKAN's package_search is offset-paginated, so make the order deterministic
// across metadata_modified ties and deliberately re-read a small overlap before
// the last committed watermark. The overlap makes an inclusive timestamp the
// checkpoint: every member of a same-timestamp group is traversed before the
// watermark can advance, even when the group spans pages.
async function collectIncrementalPackages({
    search,
    watermark = null,
    overlapMs = DEFAULT_OVERLAP_MS,
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    limit = null
}) {
    if (typeof search !== 'function') throw new TypeError('search must be a function');
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new TypeError('pageSize must be a positive integer');
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new TypeError('maxPages must be a positive integer');

    const watermarkMs = timestampMs(watermark);
    const safeOverlapMs = Number.isFinite(overlapMs) && overlapMs >= 0 ? overlapMs : DEFAULT_OVERLAP_MS;
    const boundaryMs = watermarkMs === null ? null : watermarkMs - safeOverlapMs;
    const boundaryFilter = boundaryMs === null
        ? undefined
        : 'metadata_modified:[' + new Date(boundaryMs).toISOString() + ' TO *]';
    const byId = new Map();
    let newest = watermarkMs === null ? null : new Date(watermarkMs).toISOString();
    let pagesFetched = 0;

    for (let page = 0; page < maxPages; page += 1) {
        const result = await search({
            fq: boundaryFilter,
            sort: 'metadata_modified desc, id asc',
            rows: pageSize,
            start: page * pageSize
        });
        pagesFetched += 1;
        if (!result || !Array.isArray(result.results)) {
            throw new Error('package_search returned an invalid results payload');
        }
        const rows = result.results;
        if (rows.length === 0) {
            return { packages: Array.from(byId.values()), complete: true, reason: 'end', pagesFetched, nextWatermark: newest };
        }

        let crossedBoundary = false;
        for (const pkg of rows) {
            const modified = pkg && pkg.metadata_modified;
            const modifiedMs = timestampMs(modified);
            newest = latestTimestamp(newest, modified);

            // Results are sorted newest-first. Once below the inclusive overlap
            // boundary, later rows cannot be relevant to this run.
            if (boundaryMs !== null && modifiedMs !== null && modifiedMs < boundaryMs) {
                crossedBoundary = true;
                break;
            }

            if (pkg && pkg.id) byId.set(pkg.id, pkg);
            if (limit && byId.size >= limit) {
                return { packages: Array.from(byId.values()), complete: false, reason: 'limit', pagesFetched, nextWatermark: newest };
            }
        }

        if (crossedBoundary) {
            return { packages: Array.from(byId.values()), complete: true, reason: 'watermark', pagesFetched, nextWatermark: newest };
        }
        if (rows.length < pageSize) {
            return { packages: Array.from(byId.values()), complete: true, reason: 'end', pagesFetched, nextWatermark: newest };
        }
    }

    return { packages: Array.from(byId.values()), complete: false, reason: 'page-cap', pagesFetched, nextWatermark: newest };
}

module.exports = {
    DEFAULT_MAX_PAGES,
    DEFAULT_OVERLAP_MS,
    DEFAULT_PAGE_SIZE,
    collectIncrementalPackages,
    latestTimestamp,
    timestampMs
};
