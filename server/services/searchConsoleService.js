const DIMENSIONS = ['query', 'page', 'country', 'device'];
const QUERY_PAGE_DIMENSIONS = ['query', 'page'];
const ROW_LIMIT = 25000;
const MAX_ROWS = 50000;
const SEARCH_TYPE = 'web';
const API_ROOT = 'https://www.googleapis.com/webmasters/v3/sites/';

function validateDate(value, name = 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(name + ' must use YYYY-MM-DD');
    const parsed = new Date(value + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new Error(name + ' is not a real calendar date');
    }
    return value;
}

function addDays(value, days) {
    const date = new Date(validateDate(value) + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function pacificDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return byType.year + '-' + byType.month + '-' + byType.day;
}

function dateRange(startDate, endDate, maxDays = 500) {
    validateDate(startDate, 'start date');
    validateDate(endDate, 'end date');
    if (startDate > endDate) throw new Error('start date must not be after end date');
    const dates = [];
    for (let day = startDate; day <= endDate; day = addDays(day, 1)) {
        dates.push(day);
        if (dates.length > maxDays) throw new Error('date range exceeds ' + maxDays + ' days');
    }
    return dates;
}

function responseStatus(err) {
    return Number(err?.response?.status || err?.code || 0);
}

async function requestWithRetry(request, options, { retries = 3, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await request(options);
        } catch (err) {
            const status = responseStatus(err);
            if (attempt >= retries || (status !== 429 && status < 500)) throw err;
            await sleep(Math.min(8000, 500 * (2 ** attempt)));
        }
    }
}

function normalizeDimensions(dimension, dimensions) {
    if (dimension !== null && dimensions !== null) {
        throw new Error('use either dimension or dimensions, not both');
    }
    const values = dimensions === null
        ? (dimension === null ? [] : [dimension])
        : dimensions;
    if (!Array.isArray(values) || values.some(value => !DIMENSIONS.includes(value))) {
        throw new Error('unsupported Search Console dimension');
    }
    if (new Set(values).size !== values.length) {
        throw new Error('duplicate Search Console dimension');
    }
    return values;
}

async function querySlice(request, {
    siteUrl,
    dataDate,
    dimension = null,
    dimensions = null,
    sleep
}) {
    validateDate(dataDate);
    const groupBy = normalizeDimensions(dimension, dimensions);
    const rows = [];
    const url = API_ROOT + encodeURIComponent(siteUrl) + '/searchAnalytics/query';
    for (let startRow = 0; startRow < MAX_ROWS; startRow += ROW_LIMIT) {
        const body = {
            startDate: dataDate,
            endDate: dataDate,
            type: SEARCH_TYPE,
            dataState: 'final',
            rowLimit: ROW_LIMIT,
            startRow
        };
        if (groupBy.length) body.dimensions = groupBy;
        const response = await requestWithRetry(request, { url, method: 'POST', data: body }, { sleep });
        const page = Array.isArray(response?.data?.rows) ? response.data.rows : [];
        rows.push(...page);
        if (page.length < ROW_LIMIT) return { rows, truncated: false };
    }
    return { rows, truncated: true };
}

function metricRow(row = {}) {
    return {
        clicks: Number(row.clicks) || 0,
        impressions: Number(row.impressions) || 0,
        ctr: Number(row.ctr) || 0,
        position: Number(row.position) || 0
    };
}

async function collectDay(request, { siteUrl, dataDate, sleep }) {
    const totalResult = await querySlice(request, { siteUrl, dataDate, sleep });
    const total = metricRow(totalResult.rows[0]);
    const breakdowns = [];
    const truncated = [];
    for (const dimension of DIMENSIONS) {
        const result = await querySlice(request, { siteUrl, dataDate, dimension, sleep });
        if (result.truncated) truncated.push(dimension);
        for (const row of result.rows) {
            const value = row?.keys?.[0];
            if (value == null || value === '') continue;
            breakdowns.push({ dimension, value: String(value), ...metricRow(row) });
        }
    }
    const queryPageResult = await querySlice(request, {
        siteUrl,
        dataDate,
        dimensions: QUERY_PAGE_DIMENSIONS,
        sleep
    });
    if (queryPageResult.truncated) truncated.push('query+page');
    const queryPages = queryPageResult.rows.flatMap(row => {
        const query = row?.keys?.[0];
        const page = row?.keys?.[1];
        if (query == null || query === '' || page == null || page === '') return [];
        return [{ query: String(query), page: String(page), ...metricRow(row) }];
    });
    return {
        dataDate,
        searchType: SEARCH_TYPE,
        total,
        breakdowns,
        queryPages,
        truncated
    };
}

async function syncRange({ db, request, siteUrl, startDate, endDate, logger = () => {}, sleep }) {
    const summary = { days: 0, breakdownRows: 0, queryPageRows: 0, truncated: [] };
    for (const dataDate of dateRange(startDate, endDate)) {
        const day = await collectDay(request, { siteUrl, dataDate, sleep });
        await db.replaceSearchConsoleDay(day);
        summary.days += 1;
        summary.breakdownRows += day.breakdowns.length;
        summary.queryPageRows += day.queryPages.length;
        if (day.truncated.length) summary.truncated.push({ dataDate, dimensions: day.truncated });
        logger(
            'synced ' + dataDate + ': ' + day.breakdowns.length +
            ' breakdown rows, ' + day.queryPages.length + ' query-page rows'
        );
    }
    return summary;
}

module.exports = {
    DIMENSIONS,
    QUERY_PAGE_DIMENSIONS,
    ROW_LIMIT,
    MAX_ROWS,
    SEARCH_TYPE,
    validateDate,
    addDays,
    pacificDate,
    dateRange,
    normalizeDimensions,
    requestWithRetry,
    querySlice,
    metricRow,
    collectDay,
    syncRange
};
