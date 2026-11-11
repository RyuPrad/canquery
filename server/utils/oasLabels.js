// The OAS benefit amounts dataset ("Old Age Security (OAS) - Table of Benefit Amounts by
// marital status and income level", Employment and Social Development Canada) and the
// quarters its tables cover.
const OAS_DATASET_ID = 'dfa4daf1-669e-4514-82cd-982f27707ed0';

// The five official tables and the amount columns each file carries after its period
// and income columns. Column names in a file start with the table's prefix (t1…t5).
const OAS_TABLES = Object.freeze({
    1: Object.freeze(['gistotal', 'gistotalwithoas65', 'gistotalwithoas75']),
    2: Object.freeze(['gistotal', 'gistotalwithoas65', 'gistotalwithoas75']),
    3: Object.freeze(['gistotal', 'gistotalwithoas65', 'gistotalwithoas75']),
    4: Object.freeze(['gistotal', 'gistotalwithoas65', 'gistotalwithoas75', 'alwtotal']),
    5: Object.freeze(['alwstotal'])
});

const pad = value => String(value).padStart(2, '0');

// A benefit quarter's key: the year and the quarter's last month (202612 for October
// to December 2026), the form lmia_files uses for its periods.
function periodKey(year, quarter) {
    return year * 100 + quarter * 3;
}

// { key, year, quarter, start, end } for a period key; null when it is not a quarter.
function periodOf(key) {
    const value = Number(key);
    const year = Math.floor(value / 100);
    const month = value % 100;
    if (!Number.isInteger(value) || year < 1900 || year > 2999 || ![3, 6, 9, 12].includes(month)) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { key: value, year, quarter: month / 3, start: `${year}-${pad(month - 2)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

module.exports = { OAS_DATASET_ID, OAS_TABLES, periodKey, periodOf };
