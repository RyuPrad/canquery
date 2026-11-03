// Names for the positive LMIA employers list, in English, for the HTML the server
// renders (the client has its own English and French names).
const LMIA_DATASET_ID = '90fed587-1364-4f33-a9ee-208181dc0b97';

const PROVINCE_NAMES = {
    NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island', NS: 'Nova Scotia', NB: 'New Brunswick', QC: 'Quebec',
    ON: 'Ontario', MB: 'Manitoba', SK: 'Saskatchewan', AB: 'Alberta', BC: 'British Columbia', YT: 'Yukon',
    NT: 'Northwest Territories', NU: 'Nunavut', HO: 'Head office outside Canada'
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];

// "Q2 2026", "January to June 2017", "2016" or "June 20 to December 31, 2014", from
// a period with kind/start/end (or the period_ columns).
function periodLabel(period) {
    if (!period) return '';
    const kind = period.kind || period.period_kind;
    const [year, startMonth, startDay] = String(period.start || period.period_start).split('-').map(Number);
    const [, endMonth, endDay] = String(period.end || period.period_end).split('-').map(Number);
    if (!year || !startMonth || !endMonth) return '';
    if (kind === 'quarter') return `Q${Math.ceil(endMonth / 3)} ${year}`;
    if (kind === 'year' && startMonth === 1 && startDay === 1 && endMonth === 12 && endDay === 31) return String(year);
    if (kind === 'year') return `${MONTHS[startMonth - 1]} ${startDay} to ${MONTHS[endMonth - 1]} ${endDay}, ${year}`;
    return `${MONTHS[startMonth - 1]} to ${MONTHS[endMonth - 1]} ${year}`;
}

module.exports = { LMIA_DATASET_ID, PROVINCE_NAMES, periodLabel };
