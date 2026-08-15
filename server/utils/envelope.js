// Stable response envelope for every /api/v1 endpoint.
const BASE_META = Object.freeze({
    source: 'canquery',
    license: null,
    upstream: null
});

function envelope(data, { nextCursor = null, meta = {} } = {}) {
    return {
        data,
        pagination: { nextCursor },
        meta: { ...BASE_META, ...meta }
    };
}

module.exports = { envelope };
