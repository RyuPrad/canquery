// Extract a sortable "recency" key from a resource name so the seed can pick the
// latest-period file among a dataset's many resources (e.g. "2025Q4" beats "2024Q1",
// "2026-03" beats "2026", a bare "2025" beats "2024"). Returns year*100 + month
// (month 1-12, or 0 when only a year is known), or null when no year is present.
//
// Lookbehind/lookahead guard against matching a year inside a longer number
// (e.g. the 2000 in "120000" or a "$2025.00" amount). Quarters map to their last
// month (Q1->3 ... Q4->12). We scan every match and keep the most recent, so a
// span like "2019-2025" resolves to 2025.
function parsePeriodKey(name) {
    if (!name || typeof name !== 'string') return null;
    const s = name.toLowerCase();
    let best = null;
    const consider = (year, month) => {
        const k = year * 100 + month;
        if (best === null || k > best) best = k;
    };

    let m;
    const quarter = /(?<!\d)(19\d{2}|20\d{2})\s*[-_ ]?\s*q([1-4])(?!\d)/g;
    while ((m = quarter.exec(s)) !== null) consider(Number(m[1]), Number(m[2]) * 3);

    const yearMonth = /(?<!\d)(19\d{2}|20\d{2})[-_ /](0?[1-9]|1[0-2])(?!\d)/g;
    while ((m = yearMonth.exec(s)) !== null) consider(Number(m[1]), Number(m[2]));

    const yearOnly = /(?<!\d)(19\d{2}|20\d{2})(?!\d)/g;
    while ((m = yearOnly.exec(s)) !== null) consider(Number(m[1]), 0);

    return best;
}

module.exports = { parsePeriodKey };
