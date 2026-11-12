// What the /oas pages read: the quarter of OAS benefit amounts that can be shown (the
// newest one whose five tables are all loaded, migration 054, scripts/load-oas-amounts.js),
// its key figures, a short version of each table and each table's every income band.
// Shared by the website's JSON routes (routes/oas.js) and the HTML the server renders
// for those pages; a quarter is read once and kept for five minutes in this process.
const { createCache } = require('../utils/cache');
const queries = require('../db/oasQueries');
const { OAS_DATASET_ID, TABLE_NUMBERS, periodOf } = require('../utils/oasLabels');
const { setHubAvailable, hubAvailable } = require('../utils/hubAvailability');

// The licence and source every answer about these tables carries.
const OAS_META = Object.freeze({ license: 'Open Government Licence - Canada',
    upstream: 'https://open.canada.ca/data/en/dataset/' + OAS_DATASET_ID });
const cache = createCache({ name: 'oas', ttlMs: 5 * 60 * 1000, negativeTtlMs: 60 * 1000, maxEntries: 40 });
// A band, in cents: where each value sits in the arrays the pages receive.
const COLUMNS = Object.freeze(['income_from_cents', 'income_to_cents', 'amount_cents', 'allowance_cents',
    'with_oas_65_cents', 'with_oas_75_cents']);
const [FROM, TO, AMOUNT, ALLOWANCE, WITH_65, WITH_75] = [0, 1, 2, 3, 4, 5];
const CONDENSED_ROWS = 12;

// The band that holds a yearly income, by binary search; null when no band does.
function findBand(rows, cents) {
    let low = 0;
    let high = rows.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (cents < rows[middle][FROM]) high = middle - 1;
        else if (cents > rows[middle][TO]) low = middle + 1;
        else return rows[middle];
    }
    return null;
}

// A table in about a dozen lines: the band of every round step of income, from 0 to
// the last income the table lists. The step is a whole thousand dollars.
function condensed(rows) {
    const end = rows[rows.length - 1][TO] + 1;
    const step = Math.max(1, Math.ceil(end / CONDENSED_ROWS / 100000)) * 100000;
    const picked = [];
    for (let income = 0; income < end; income += step) {
        const band = findBand(rows, income);
        if (band && picked[picked.length - 1] !== band) picked.push(band);
    }
    return picked;
}

// The full OAS pension the publisher added to the GIS, when it is the same amount on
// every row of the table; null otherwise (and for table 5, which has no such column).
function pension(rows, column) {
    if (rows[0][column] === null) return null;
    const first = rows[0][column] - rows[0][AMOUNT];
    return rows.every(row => row[column] - row[AMOUNT] === first) ? first : null;
}

// A table's key figures: its first band's amounts and the first yearly income it no
// longer lists.
function figures(entry) {
    const rows = entry.rows;
    return { table: entry.table, resource_id: entry.resource_id, row_count: rows.length,
        max_amount_cents: rows[0][AMOUNT], max_allowance_cents: rows[0][ALLOWANCE],
        ends_at_cents: rows[rows.length - 1][TO] + 1 };
}

// A quarter as the pages use it, from the one-statement read; null unless it holds
// exactly the five tables, each with rows.
function shape(row) {
    if (!row || !Array.isArray(row.tables)) return null;
    const period = periodOf(row.period_key);
    const tables = {};
    for (const entry of row.tables) {
        if (!entry || !Array.isArray(entry.rows) || !entry.rows.length) return null;
        tables[entry.table] = { table: entry.table, resource_id: entry.resource_id, rows: entry.rows };
    }
    if (!period || !TABLE_NUMBERS.every(number => tables[number]) || Object.keys(tables).length !== TABLE_NUMBERS.length) return null;
    // The pension is named only when tables 1 to 4 all add the same amount.
    const same = column => {
        const found = new Set([1, 2, 3, 4].map(number => pension(tables[number].rows, column)));
        return found.size === 1 ? [...found][0] : null;
    };
    const oas65 = same(WITH_65);
    const oas75 = same(WITH_75);
    return {
        period: { ...period, income_year: row.income_year, loaded_at: new Date(row.loaded_at).toISOString() },
        oas: oas65 !== null && oas75 !== null ? { age_65_cents: oas65, age_75_cents: oas75 } : null,
        tables
    };
}

function quarter(period, deps) {
    return cache.get('period:' + (period === null ? 'latest' : period), async () => shape(await deps.getOasPeriod({ period })));
}
// Every quarter that can be shown, oldest first.
function quarters(deps) {
    return cache.get('periods', async () => (await deps.listOasPeriods()).map(row => ({ ...periodOf(row.period_key), income_year: row.income_year })));
}

// The quarter shown, its key figures and short tables, and the figures of the
// quarter before it when that one is loaded too. null until a first quarter is whole.
async function summary(deps = queries) {
    const current = await quarter(null, deps);
    setHubAvailable('oas', Boolean(current));
    if (!current) return null;
    const periods = (await quarters(deps)).filter(period => period && period.key <= current.period.key);
    const before = periods.filter(period => period.key < current.period.key).pop();
    const previous = before ? await quarter(before.key, deps) : null;
    return {
        dataset_id: OAS_DATASET_ID, period: current.period, updated_at: current.period.loaded_at, oas: current.oas,
        columns: COLUMNS,
        tables: TABLE_NUMBERS.map(number => ({ ...figures(current.tables[number]), condensed: condensed(current.tables[number].rows) })),
        previous: previous ? { period: previous.period, oas: previous.oas, tables: TABLE_NUMBERS.map(number => figures(previous.tables[number])) } : null,
        periods
    };
}

// One table of the quarter shown (or of another loaded quarter): its figures and
// every income band. null for an unknown table or a quarter that cannot be shown.
async function table(number, { period = null } = {}, deps = queries) {
    if (!TABLE_NUMBERS.includes(number)) return null;
    if (period !== null && !(await quarters(deps)).some(known => known && known.key === period)) return null;
    const found = await quarter(period, deps);
    if (!found) return null;
    return { period: found.period, oas: found.oas, table: figures(found.tables[number]), columns: COLUMNS, rows: found.tables[number].rows };
}

// Whether the hub had a quarter to show when it was last read (the sitewide links
// follow this), and a loop that keeps reading it so the answer stays current.
const available = () => hubAvailable('oas');
function startOasWarming({ intervalMs = 10 * 60 * 1000 } = {}) {
    const { startWarming } = require('../utils/warming');
    return startWarming('oas-amounts', [() => summary()], { intervalMs });
}

module.exports = { OAS_META, COLUMNS, CONDENSED_ROWS, findBand, condensed, pension, figures, shape, summary, table, available, startOasWarming, cache };
