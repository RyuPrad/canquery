const PAGE_SIZE = 50;

function pageNumber(params = new URLSearchParams()) {
    const values = params.getAll('page');
    if (!values.length) return 1;
    if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
    const page = Number(values[0]);
    return Number.isSafeInteger(page) && page <= Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE) ? page : null;
}

function pagePath(path, page) {
    return path + (page > 1 ? '?page=' + page : '');
}

function pageSlice(rows, page, path) {
    return { page, path, items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

module.exports = { PAGE_SIZE, pageNumber, pagePath, pageSlice };
