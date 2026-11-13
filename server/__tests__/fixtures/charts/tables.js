// Small tables, one per way publisher files go wrong. Each is what the loader
// would have stored: recorded columns and rows of text cells (null where a
// typed column is empty). Rows are generated, never random, so every run
// profiles the same table.
const text = id => ({ id, type: 'TEXT', original_label: id });
const integer = id => ({ id, type: 'INTEGER', original_label: id });
const numeric = id => ({ id, type: 'NUMERIC', original_label: id });
const date = id => ({ id, type: 'DATE', original_label: id });

const PROVINCES = [['Ontario', 'Ontario'], ['Quebec', 'Québec'], ['British Columbia', 'Colombie-Britannique'], ['Alberta', 'Alberta'],
    ['Manitoba', 'Manitoba'], ['Nova Scotia', 'Nouvelle-Écosse']];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FR = ['janv.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Rows as the engine's sample returns them: _id first, then the cells.
const withIds = rows => rows.map((row, index) => [index + 1, ...row]);
// Values that jump about, the same on every run.
const scatter = (i, span) => (i * 7919 + 4513) % span;

// 1. A statistics table whose only measure is text because most cells are "--".
function suppressedCounts() {
    const rows = [];
    for (let year = 2019; year <= 2022; year += 1) {
        for (let month = 0; month < 12; month += 1) {
            PROVINCES.forEach(([en, fr], p) => {
                const value = (year + month + p) % 4 === 0 ? String(5 * (1 + ((year * 7 + month * 3 + p) % 40))) : '--';
                rows.push([String(year), MONTHS_EN[month], String(year), MONTHS_FR[month], en, fr, value]);
            });
        }
    }
    return { columns: [integer('EN_YEAR'), text('EN_MONTH'), integer('FR_ANNEE'), text('FR_MOIS'), text('EN_PROVINCE/TERRITORY'),
        text('FR_PROVINCE/TERRITOIRE'), text('TOTAL')], rows: withIds(rows) };
}

// 2. Every way a number is written as text.
function numberFormats() {
    const rows = [];
    for (let i = 0; i < 40; i += 1) {
        const n = 1000 + scatter(i, 8000);
        rows.push(['Unit ' + (i % 8), n.toLocaleString('en-CA'), '$' + (n + 0.5).toLocaleString('en-CA', { minimumFractionDigits: 2 }),
            scatter(i, 97) + '%', String(scatter(i, 300) + 0.5).replace('.', ','), i % 5 === 0 ? '(' + n + ')' : String(n),
            String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',5', i < 2 ? '1,' + (234 + i) : String(900 + i)]);
    }
    return { columns: [text('Unit'), text('Visits'), text('Cost'), text('Share'), text('Taux'), text('Balance'), text('Montant'), text('Guess')],
        rows: withIds(rows) };
}

// 3. Codes: zero-padded, same length, and "code - label".
function codes() {
    const jobs = ['6322 - Cooks', '6311 - Food service supervisors', '7511 - Transport truck drivers', '0621 - Retail managers'];
    const rows = [];
    for (let i = 0; i < 120; i += 1) rows.push([String(1 + (i % 12)).padStart(2, '0'), String(4100 + (i % 40) * 13), jobs[i % 4], String(10 + scatter(i, 500))]);
    return { columns: [text('C_MNTH'), integer('WMU'), text('Occupation'), integer('Positions')], rows: withIds(rows) };
}

// 4. Row numbers, keys, constants, empty columns and near-unique names.
function identifiers() {
    const rows = [];
    for (let i = 0; i < 200; i += 1) {
        rows.push([String(i + 1), String(700000 + i * 13), String(100000000 + i * 7919) + 'RR0001', '27', null, '', 'Charity number ' + (i + 1) + ' of the list',
            ['Active', 'Revoked', 'Annulled'][i % 3], String(500 + scatter(i, 9000))]);
    }
    return { columns: [integer('#'), integer('Corporation number'), text('BN'), integer('Form ID'), text('Notes'), text('column_9'), text('Legal name'),
        text('Status'), integer('Total Gifts')], rows: withIds(rows) };
}

// 5. Periods written as text.
function textPeriods() {
    const rows = [];
    for (let i = 0; i < 48; i += 1) {
        const year = 2012 + Math.floor(i / 4);
        const month = 10 + (i % 3);
        rows.push(['Q' + (1 + (i % 4)) + ' - ' + year, year + '-' + (year + 1), '2009-' + month, String(year), String(100 + scatter(i, 700))]);
    }
    return { columns: [text('Fiscal Quarter'), text('Fiscal Year'), text('Month'), text('Year'), integer('Cases')], rows: withIds(rows) };
}

// 6. A year column with a month-name column, and a quarter number.
function yearAndParts() {
    const rows = [];
    for (let year = 2020; year <= 2022; year += 1) {
        for (let month = 0; month < 12; month += 1) {
            for (const region of ['East', 'West']) rows.push([String(year), MONTHS_EN[month], String(1 + Math.floor(month / 3)), region, String(10 + month + (region === 'East' ? 5 : 0))]);
        }
    }
    return { columns: [integer('Year'), text('Month'), integer('Quarter'), text('Region'), integer('Permits')], rows: withIds(rows) };
}

// 7. A wide table: one row per country, one column per month, a yearly total.
function widePeriods() {
    const columns = [text('Country of Birth')];
    for (let month = 1; month <= 12; month += 1) columns.push(text('2023 / ' + String(month).padStart(2, '0')));
    columns.push(text('2023 Total'));
    const rows = [];
    for (let i = 0; i < 30; i += 1) {
        const cells = [];
        let total = 0;
        for (let month = 0; month < 12; month += 1) {
            const value = 5 * scatter(i * 12 + month, 60);
            total += value;
            cells.push((i + month) % 7 === 0 && i % 3 === 0 ? '--' : String(value));
        }
        rows.push(['Country ' + (i + 1), ...cells, String(total)]);
    }
    return { columns, rows: withIds(rows) };
}

// 8. Twin columns: by values, by name, and a code beside its label.
function twins() {
    const regions = [['ER10', 'Northeast', 'Nord-est'], ['ER20', 'Ottawa', 'Ottawa'], ['ER30', 'West Coast', 'Côte-ouest'], ['ER40', 'Southwest', 'Sud-ouest']];
    const rows = [];
    for (let i = 0; i < 160; i += 1) {
        const [en, fr] = PROVINCES[i % 6];
        const region = regions[(i * 5) % 4];
        rows.push([en, fr, ['Yes', 'No', 'Maybe'][i % 3], ['Oui', 'Non', 'Peut-être'][i % 3], region[0], region[1], region[2], String(20 + (i % 30))]);
    }
    return { columns: [text('EN_PROVINCE/TERRITORY'), text('FR_PROVINCE/TERRITOIRE'), text('answer_e'), text('answer_f'), text('ER_Code'), text('ER_Name'),
        text('Nom_RE'), numeric('Median_Wage')], rows: withIds(rows) };
}

// 9. A report-style table: French second header, a unit row, notes, a repeated
// header, and total rows.
function reportStyle() {
    const body = [];
    for (let year = 2005; year <= 2020; year += 1) {
        body.push([String(year), String(100 + (year % 7) * 3), String(40 + (year % 5)) + '.5', 'Canada']);
        body.push([String(year), String(60 + (year % 4) * 2), String(20 + (year % 3)) + '.25', 'Ontario']);
    }
    const rows = [
        ['Année', 'Émissions', 'Concentration', 'Région'],
        ['', 'kg', 'mg', ''],
        ...body.slice(0, 16),
        ['Year', 'Emissions', 'Concentration', 'Region'],
        ...body.slice(16),
        ['Total', '2640', 'n/a', 'Total'],
        ['Note: Values are preliminary and may be revised by the department.', '', '', ''],
        ['Source: Environment and Climate Change Canada.', '', '', '']
    ];
    return { columns: [text('Year'), text('Emissions'), text('Concentration'), text('Region')], rows: withIds(rows) };
}

// 10. The same category spelled with padding and in two cases.
function untidyCategories() {
    const rows = [];
    for (let i = 0; i < 90; i += 1) rows.push([['High Wage', 'High Wage      ', 'HIGH WAGE', 'Low Wage', 'low wage', 'Global Talent'][i % 6], ['TORONTO', 'Toronto', 'Ottawa'][i % 3], String(1 + (i % 9))]);
    return { columns: [text('Stream'), text('City'), integer('Approved Positions')], rows: withIds(rows) };
}

// 11. A measure-name table, and a table in two currencies.
function measureNames() {
    const points = [['Total assets', 1e9], ['Net income', 5e6], ['Capital ratio', 0.14], ['Number of branches', 40]];
    const rows = [];
    for (let i = 0; i < 160; i += 1) {
        const [label, scale] = points[i % 4];
        rows.push([String(2015 + (i % 8)), 'Bank ' + (1 + (i % 5)), label, String(Number((scale * (1 + (i % 7) / 10)).toPrecision(6)))]);
    }
    return { columns: [integer('Fiscal Year'), text('Institution'), text('Data Point Label'), numeric('Measure Value')], rows: withIds(rows) };
}

function twoCurrencies() {
    const rows = [];
    for (let i = 0; i < 80; i += 1) rows.push([['Paris', 'Tokyo', 'Ottawa', 'Calgary'][i % 4], ['USD', 'USD', 'CAD', 'CAD'][i % 4], String(100 + (i % 20) * 5)]);
    return { columns: [text('City'), text('Currency'), integer('Max rate')], rows: withIds(rows) };
}

// 12. Rates, ratios and indexes beside a count.
function ratesAndCounts() {
    const rows = [];
    for (let i = 0; i < 100; i += 1) rows.push([['A', 'B', 'C', 'D', 'E'][i % 5], String(50 + scatter(i, 400)), String(scatter(i, 100) / 10), String(0.25 + (i % 4) / 10), String(95 + scatter(i, 30))]);
    return { columns: [text('Sector'), integer('Employees'), numeric('Unemployment rate'), numeric('Male ratio'), numeric('Price index')], rows: withIds(rows) };
}

// 13. Coordinates, postal codes, addresses on the web.
function places() {
    const rows = [];
    for (let i = 0; i < 60; i += 1) {
        rows.push(['Site ' + (i + 1), (45 + i * 0.0137).toFixed(5), (-75 - i * 0.0211).toFixed(5), 'K1A 0B' + (i % 10), 'https://example.org/site/' + (i + 1),
            String(120 + i * 1.5), ['Park', 'Library', 'Arena'][i % 3]]);
    }
    return { columns: [text('Name'), numeric('Latitude'), numeric('Longitude'), text('Postal Code'), text('Website'), numeric('Shape__Area'), text('Type')],
        rows: withIds(rows) };
}

// 15. A clean typed table of events.
function cleanEvents() {
    const rows = [];
    for (let i = 0; i < 300; i += 1) {
        const day = new Date(Date.UTC(2015, 0, 1) + i * 8 * 86400000).toISOString().slice(0, 10);
        rows.push([String(900000 + i * 3), day, ['Federal', 'Ontario', 'Quebec'][i % 3], ['Active', 'Dissolved'][i % 2], String(1000 + scatter(i, 50000))]);
    }
    return { columns: [integer('Corporation number'), date('Incorporation date'), text('Jurisdiction'), text('Status'), integer('Share capital')],
        rows: withIds(rows) };
}

// 16. A number column the loader gave up on because of late bad values.
function castFailed() {
    const rows = [];
    for (let i = 0; i < 150; i += 1) rows.push([['North', 'South', 'East'][i % 3], i === 140 ? 'see note' : i % 50 === 49 ? 'x' : String(200 + scatter(i, 4000))]);
    return { columns: [text('Zone'), { id: 'Volume', type: 'TEXT', original_label: 'Volume', cast_failed: true }], rows: withIds(rows) };
}

// 17. One row per year, every figure higher than the last: sorted and unique,
// like a key, and still a measure.
function risingSeries() {
    const rows = [];
    for (let year = 1996; year <= 2025; year += 1) rows.push([String(year), String(29600000 + (year - 1996) * 331000), String(1 + year - 1996), ((year - 1996) * 1.5 + 60).toFixed(1) + '%']);
    return { columns: [integer('Year'), integer('Population'), integer('Rank'), text('Urban share')], rows: withIds(rows) };
}

// 18. A panel in period order: every year lists the same provinces.
function balancedPanel(years = 60) {
    const rows = [];
    for (let year = 0; year < years; year += 1) {
        PROVINCES.concat([['Yukon', 'Yukon'], ['Nunavut', 'Nunavut'], ['Saskatchewan', 'Saskatchewan']])
            .forEach(([en], p) => rows.push([String(1960 + year), en, (5 + ((year * 31 + p * 17) % 90) / 10).toFixed(1)]));
    }
    return { columns: [integer('Year'), text('Province'), numeric('Unemployment rate')], rows: withIds(rows) };
}

module.exports = { risingSeries, balancedPanel, suppressedCounts, numberFormats, codes, identifiers, textPeriods, yearAndParts, widePeriods, twins, reportStyle, untidyCategories,
    measureNames, twoCurrencies, ratesAndCounts, places, cleanEvents, castFailed };
