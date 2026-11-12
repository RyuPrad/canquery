// The head and the HTML the server renders for the /oas pages (the hub and one page
// per official table), in English and in French (/fr/sv): the quarter's key figures,
// a short version of each table, and on a table's page every income band. The
// application draws the same content over it; crawlers and visitors without
// JavaScript read this. Amounts come from services/oasPages.js in whole cents.
const seo = require('./seoMeta');
const { shell, exact } = require('./seoSnapshot');
const { listArticles } = require('./blogContent');
const {
    OAS_DATASET_ID, TABLE_NUMBERS, periodLabel, dateLabel, periodState, todayInCanada, formatMoney, formatDollars, formatBand,
    formatChange, oasPath, oasTablePath, copy, tableTitle, officialLinks, NBSP
} = require('../utils/oasLabels');

const [FROM, TO, AMOUNT, ALLOWANCE, WITH_65, WITH_75] = [0, 1, 2, 3, 4, 5];
// A table's page shows its bands in at most this many sections, each under its income range.
const SECTIONS = 12;
const escape = seo.escapeHtml;
const language = lang => (lang === 'fr' ? 'fr' : 'en');
// "1,140" / "1 140" (French groups thousands with a no-break space).
const count = (value, lang) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, language(lang) === 'fr' ? NBSP : ',');
const lowerFirst = value => value.charAt(0).toLowerCase() + value.slice(1);

// Page wording that only the server's HTML uses. Table names, income definitions,
// column headings and the caveat come from utils/oasLabels.js.
const TEXT = {
    en: {
        title: short => `OAS and Guaranteed Income Supplement amounts: ${short}`,
        titlePlain: 'OAS and Guaranteed Income Supplement amounts by income',
        tableTitles: {
            1: short => `GIS Table 1, single person: amounts by income, ${short}`,
            2: short => `GIS Table 2 for couples, both on OAS: ${short}`,
            3: short => `GIS Table 3, spouse without OAS pension: ${short}`,
            4: short => `GIS Table 4, couple with the Allowance: ${short}`,
            5: short => `Allowance for the Survivor amounts (Table 5): ${short}`
        },
        heading: long => `Guaranteed Income Supplement, Allowance and OAS pension amounts, ${long}`,
        headingPlain: 'Guaranteed Income Supplement, Allowance and OAS pension amounts',
        descriptions: long => [
            `Guaranteed Income Supplement (GIS), Allowance and OAS pension amounts by yearly income: look up the official ${long} tables.`,
            `Monthly GIS, Allowance and OAS pension amounts by yearly income, from the official ${long} tables.`
        ],
        descriptionPlain: 'Find the monthly Guaranteed Income Supplement (GIS) or Allowance for a yearly income in the official tables Employment and Social Development Canada publishes each quarter.',
        tableDescriptions: {
            1: long => `GIS amounts for a single person receiving the OAS pension: the monthly amount for every yearly income in the official ${long} table (Table 1).`,
            2: long => `GIS amounts for a couple who both receive the OAS pension: monthly amounts by combined yearly income, official ${long} table (Table 2).`,
            3: long => `GIS amounts when a spouse or partner does not receive the OAS pension: monthly amounts by combined income, official ${long} table (Table 3).`,
            4: long => `GIS and Allowance amounts for a couple: monthly amounts by combined yearly income in the official ${long} table (Table 4).`,
            5: long => `Allowance for the Survivor amounts: the monthly amount for every yearly income in the official ${long} table (Table 5).`
        },
        tableDescriptionPlain: (table, long) => `GIS and Allowance amounts, Table ${table}, ${long}: monthly amounts by yearly income.`,
        lead: (long, year) => 'Find the monthly Guaranteed Income Supplement (GIS) or Allowance for a yearly income in the tables ' +
            `Employment and Social Development Canada publishes each quarter. These are the tables for ${long}; they are based on income for ${year}.`,
        tableLead: (title, long, income, year) => `${title} is one of the five tables of benefit amounts for ${long}. Each row is a range of ` +
            `yearly income (${income}, for ${year}) with the monthly amount for it.`,
        facts: { quarter: 'Quarter', incomeYear: 'Income year the tables use', oas65: 'Full OAS pension, age 65 to 74',
            oas75: 'Full OAS pension, age 75 and over', publisher: 'Published by', loaded: 'Loaded by CanQuery', bands: 'Income bands' },
        publisher: 'Employment and Social Development Canada',
        monthly: money => `${money} a month`,
        maximum: { gis: 'Maximum monthly GIS', survivor: 'Maximum monthly Allowance for the Survivor', allowance: 'Maximum monthly Allowance' },
        endsAt: 'Listed for yearly incomes below',
        keyCaption: long => `Maximum monthly amounts, ${long}`,
        keyHeaders: ['Table', 'Maximum monthly amount', 'Listed for yearly incomes below'],
        both: (gis, allowance) => `GIS ${gis}; Allowance ${allowance}`,
        changeCaption: before => `Change from ${before}`,
        changeHeaders: (before, now) => ['Amount', before, now, 'Change'],
        changeRow: { gis: table => `Table ${table}, maximum GIS`, survivor: table => `Table ${table}, maximum Allowance for the Survivor`,
            allowance: table => `Table ${table}, maximum Allowance` },
        tableSummary: (income, maximum, ends) => `${income}. Maximum ${maximum}; listed for yearly incomes below ${ends}.`,
        allBands: (bands, table) => `All ${bands} income bands of Table ${table}`,
        tablesTitle: 'The five tables',
        bands: bands => `${bands} income bands`,
        filesTitle: 'The official files on CanQuery',
        datasetLink: 'Old Age Security (OAS): Table of Benefit Amounts, every file',
        fileLink: table => `Table ${table} as a CSV table`,
        othersTitle: 'The other tables',
        jump: 'Income ranges',
        range: band => `Yearly income ${band}`,
        shell: {}
    },
    fr: {
        title: short => `Pension de vieillesse et SRG : montants ${short}`,
        titlePlain: 'Pension de vieillesse et SRG : montants selon le revenu',
        tableTitles: {
            1: short => `SRG Tableau 1, personne seule : montants ${short}`,
            2: short => `SRG Tableau 2, couple de pensionnés : ${short}`,
            3: short => `SRG Tableau 3, conjoint sans pension : ${short}`,
            4: short => `SRG Tableau 4, couple avec l’Allocation : ${short}`,
            5: short => `Allocation au survivant, Tableau 5 : ${short}`
        },
        heading: long => `Montants du Supplément de revenu garanti, de l’Allocation et de la pension de la Sécurité de la vieillesse, ${long}`,
        headingPlain: 'Montants du Supplément de revenu garanti, de l’Allocation et de la pension de la Sécurité de la vieillesse',
        descriptions: long => [
            `Supplément de revenu garanti (SRG), Allocation et pension de vieillesse : montants mensuels selon le revenu, tableaux officiels pour ${long}.`,
            `Montants mensuels du SRG, de l’Allocation et de la pension de la SV selon le revenu annuel, tableaux officiels pour ${long}.`
        ],
        descriptionPlain: 'Trouvez le montant mensuel du Supplément de revenu garanti (SRG) ou de l’Allocation selon le revenu annuel, dans les tableaux officiels qu’Emploi et Développement social Canada publie chaque trimestre.',
        tableDescriptions: {
            1: long => `Montants du SRG pour une personne seule qui reçoit la pension de la SV : montant mensuel selon le revenu annuel, tableau officiel pour ${long}.`,
            2: long => `Montants du SRG pour un couple dont les deux reçoivent la pension de la SV : montants mensuels selon le revenu combiné, tableau pour ${long}.`,
            3: long => `Montants du SRG quand le conjoint ne reçoit pas la pension de la SV : montants mensuels selon le revenu combiné, tableau pour ${long}.`,
            4: long => `Montants du SRG et de l’Allocation pour un couple : montants mensuels selon le revenu combiné, tableau officiel pour ${long} (Tableau 4).`,
            5: long => `Montants de l’Allocation au survivant : le montant mensuel selon le revenu annuel, tableau officiel pour ${long} (Tableau 5).`
        },
        tableDescriptionPlain: (table, long) => `Montants du SRG et de l’Allocation, tableau ${table}, ${long} : montants mensuels selon le revenu annuel.`,
        lead: (long, year) => 'Trouvez le montant mensuel du Supplément de revenu garanti (SRG) ou de l’Allocation pour un revenu annuel dans les ' +
            `tableaux qu’Emploi et Développement social Canada publie chaque trimestre. Voici les tableaux pour ${long}; ils reposent sur le revenu de ${year}.`,
        tableLead: (title, long, income, year) => `« ${title} » est l’un des cinq tableaux des montants des prestations pour ${long}. Chaque ligne ` +
            `est une tranche de revenu annuel (${income}, pour ${year}) avec le montant mensuel correspondant.`,
        facts: { quarter: 'Trimestre', incomeYear: 'Année de revenu considérée', oas65: 'Pleine pension de la SV, 65 à 74 ans',
            oas75: 'Pleine pension de la SV, 75 ans et plus', publisher: 'Publié par', loaded: 'Chargé par CanQuery', bands: 'Tranches de revenu' },
        publisher: 'Emploi et Développement social Canada',
        monthly: money => `${money} par mois`,
        maximum: { gis: 'SRG mensuel maximal', survivor: 'Allocation au survivant mensuelle maximale', allowance: 'Allocation mensuelle maximale' },
        endsAt: 'Indiqué pour les revenus annuels inférieurs à',
        keyCaption: long => `Montants mensuels maximaux, ${long}`,
        keyHeaders: ['Tableau', 'Montant mensuel maximal', 'Indiqué pour les revenus annuels inférieurs à'],
        both: (gis, allowance) => `SRG ${gis}; Allocation ${allowance}`,
        changeCaption: before => `Variation depuis ${before}`,
        changeHeaders: (before, now) => ['Montant', before, now, 'Variation'],
        changeRow: { gis: table => `Tableau ${table}, SRG maximal`, survivor: table => `Tableau ${table}, Allocation au survivant maximale`,
            allowance: table => `Tableau ${table}, Allocation maximale` },
        tableSummary: (income, maximum, ends) => `${income}. Maximum : ${maximum}; indiqué pour les revenus annuels inférieurs à ${ends}.`,
        allBands: (bands, table) => `Les ${bands} tranches de revenu du tableau ${table}`,
        tablesTitle: 'Les cinq tableaux',
        bands: bands => `${bands} tranches de revenu`,
        filesTitle: 'Les fichiers officiels sur CanQuery',
        datasetLink: 'Sécurité de la vieillesse (SV) : Tableau des montants des prestations, tous les fichiers',
        fileLink: table => `Tableau ${table} (table CSV)`,
        othersTitle: 'Les autres tableaux',
        jump: 'Tranches de revenu',
        range: band => `Revenu annuel de ${band}`,
        shell: { breadcrumb: 'Fil d’Ariane', sources: 'Sources officielles et licences', guides: 'Guides des données' }
    }
};
const text = lang => TEXT[language(lang)];

// ---- Shared pieces ----------------------------------------------------------------

// Which amount a table's own column holds, and whether it has the others.
const kind = table => (table === 5 ? 'survivor' : 'gis');
const hasAllowance = table => table === 4;
const hasPension = table => table !== 5;

// Guides about the dataset, this page's language first; the other language is labelled.
function guides(lang) {
    const own = language(lang);
    return [own, own === 'fr' ? 'en' : 'fr'].flatMap(code => listArticles({ lang: code, dataset: OAS_DATASET_ID })
        .map(article => ({ path: article.path, label: article.title, detail: code === own ? '' : code === 'fr' ? '(français)' : '(English)' })));
}

function breadcrumbs(lang, last) {
    const words = copy(lang);
    return [{ path: '/datasets', label: words.datasets }, { path: '/datasets/' + OAS_DATASET_ID, label: words.dataset }, ...last];
}
function breadcrumbJsonLd(lang, last) {
    const words = copy(lang);
    return seo.buildBreadcrumbJsonLd([{ name: words.datasets, path: '/datasets' },
        { name: words.dataset, path: '/datasets/' + OAS_DATASET_ID }, ...last]);
}
// The same page in each language, for hreflang.
function alternates(path) {
    return { 'en-CA': seo.SITE_URL + path('en'), 'fr-CA': seo.SITE_URL + path('fr'), 'x-default': seo.SITE_URL + path('en') };
}
// The first wording that fits a search result's description.
const fitDescription = candidates => candidates.find(candidate => candidate.length <= 160) || seo.truncate(candidates[candidates.length - 1], 160);

function webPage({ lang, path, name, description, summary }) {
    return { '@context': 'https://schema.org', '@type': 'WebPage', url: seo.SITE_URL + path, name, description,
        inLanguage: language(lang) === 'fr' ? 'fr-CA' : 'en-CA', dateModified: summary.updated_at,
        isBasedOn: 'https://open.canada.ca/data/en/dataset/' + OAS_DATASET_ID,
        isPartOf: { '@type': 'WebSite', name: seo.SITE_NAME, url: seo.SITE_URL + '/' } };
}

// A table of escaped text. A cell is a string, or { href, label } for a link; the
// first cell of each row is its header.
function htmlTable({ caption, headers, rows, numeric = true }) {
    const cell = value => (value && typeof value === 'object'
        ? '<a href="' + escape(value.href) + '">' + escape(value.label) + '</a>' : escape(value));
    return '<div class="overflow-x-auto"><table' + (numeric ? ' data-cq-amounts="true"' : '') + '>' +
        (caption ? '<caption>' + escape(caption) + '</caption>' : '') + '<thead><tr>' +
        headers.map(header => '<th scope="col">' + escape(header) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(row => '<tr>' + row.map((value, index) => (index === 0 ? '<th scope="row">' + cell(value) + '</th>'
            : '<td>' + cell(value) + '</td>')).join('') + '</tr>').join('') + '</tbody></table></div>';
}

// The column headings and the cells of a band, for a table's own columns.
function bandHeaders(table, lang) {
    const columns = copy(lang).columns;
    return [columns.income, columns[kind(table)], ...(hasAllowance(table) ? [columns.allowance] : []),
        ...(hasPension(table) ? [columns.with65, columns.with75] : [])];
}
function bandCells(table, row, lang) {
    return [formatBand(row[FROM], row[TO], lang), formatMoney(row[AMOUNT], lang),
        ...(hasAllowance(table) ? [formatMoney(row[ALLOWANCE], lang)] : []),
        ...(hasPension(table) ? [formatMoney(row[WITH_65], lang), formatMoney(row[WITH_75], lang)] : [])];
}

// The line a page shows when its quarter has not started or has ended.
function periodNote(period, lang, now) {
    const state = periodState(period, todayInCanada(now));
    const words = copy(lang);
    if (state === 'upcoming') return words.upcoming.replace('{date}', dateLabel(period.start, lang));
    if (state === 'ended') return words.ended.replace('{period}', periodLabel(period, lang));
    return '';
}
const twinLink = (path, lang) => '<p><a href="' + escape(path(language(lang) === 'fr' ? 'en' : 'fr')) + '" hreflang="' +
    copy(lang).twinLang + '" lang="' + copy(lang).twinLang + '">' + escape(copy(lang).twin) + '</a></p>';
const paragraph = value => (value ? '<p>' + escape(value) + '</p>' : '');

// A table's largest amounts, as the key figures show them.
function maximumText(entry, lang) {
    const words = text(lang);
    const amount = words.monthly(formatMoney(entry.max_amount_cents, lang));
    return hasAllowance(entry.table)
        ? words.both(amount, words.monthly(formatMoney(entry.max_allowance_cents, lang))) : amount;
}

// ---- The hub ----------------------------------------------------------------------

function oasMeta(summary, lang) {
    const words = text(lang);
    const path = oasPath(lang);
    const crumbs = breadcrumbJsonLd(lang, [{ name: copy(lang).hub, path }]);
    const shared = { canonical: seo.SITE_URL + path, lang: language(lang), ogType: 'website', alternates: alternates(oasPath) };
    if (!summary) return { ...shared, title: words.titlePlain + ' - CanQuery', description: words.descriptionPlain, noindex: true, jsonLd: [crumbs] };
    const title = seo.fitTitleTiers([[words.title(periodLabel(summary.period, lang, { short: true }))], [words.titlePlain]]);
    const description = fitDescription(words.descriptions(periodLabel(summary.period, lang)));
    return { ...shared, title: title + ' - CanQuery', description,
        jsonLd: [crumbs, webPage({ lang, path, name: title, description, summary })] };
}

function oasSnapshot(summary, lang, { now = new Date() } = {}) {
    const words = text(lang);
    const shared = copy(lang);
    const datasetLink = { path: '/datasets/' + OAS_DATASET_ID, label: words.datasetLink };
    if (!summary) {
        return shell({ breadcrumbs: breadcrumbs(lang, [{ label: shared.hub }]), title: exact(words.headingPlain),
            lead: exact(shared.loading), overviewHtml: twinLink(oasPath, lang), sources: officialLinks(lang),
            relatedTitle: words.filesTitle, relatedLinks: [datasetLink], guides: guides(lang), labels: words.shell });
    }
    const { period, previous } = summary;
    const long = periodLabel(period, lang);
    const keyRows = summary.tables.map(entry => [{ href: oasTablePath(lang, entry.table), label: tableTitle(entry.table, lang) },
        maximumText(entry, lang), formatDollars(entry.ends_at_cents, lang)]);
    let change = '';
    if (previous) {
        const rows = [];
        const line = (label, before, after) => rows.push([label, formatMoney(before, lang), formatMoney(after, lang), formatChange(after, before, lang)]);
        for (const entry of summary.tables) {
            const old = previous.tables.find(item => item.table === entry.table);
            if (!old) continue;
            line(words.changeRow[kind(entry.table)](entry.table), old.max_amount_cents, entry.max_amount_cents);
            if (hasAllowance(entry.table)) line(words.changeRow.allowance(entry.table), old.max_allowance_cents, entry.max_allowance_cents);
        }
        if (summary.oas && previous.oas) {
            line(words.facts.oas65, previous.oas.age_65_cents, summary.oas.age_65_cents);
            line(words.facts.oas75, previous.oas.age_75_cents, summary.oas.age_75_cents);
        }
        const before = periodLabel(previous.period, lang);
        change = '<section><h2>' + escape(words.changeCaption(before)) + '</h2>' +
            htmlTable({ headers: words.changeHeaders(before, long), rows }) + '</section>';
    }
    const short = summary.tables.map(entry => '<section id="table-' + entry.table + '"><h2>' + escape(tableTitle(entry.table, lang)) + '</h2>' +
        paragraph(words.tableSummary(shared.income[entry.table], maximumText(entry, lang), formatDollars(entry.ends_at_cents, lang))) +
        htmlTable({ headers: bandHeaders(entry.table, lang), rows: entry.condensed.map(row => bandCells(entry.table, row, lang)) }) +
        '<p><a href="' + escape(oasTablePath(lang, entry.table)) + '">' + escape(words.allBands(count(entry.row_count, lang), entry.table)) +
        '</a></p></section>').join('');
    return shell({
        breadcrumbs: breadcrumbs(lang, [{ label: shared.hub }]),
        title: exact(words.heading(long)),
        lead: exact(words.lead(long, period.income_year) + ' ' + shared.caveat),
        facts: [
            { label: words.facts.quarter, value: exact(long) },
            { label: words.facts.incomeYear, value: period.income_year },
            summary.oas ? { label: words.facts.oas65, value: exact(words.monthly(formatMoney(summary.oas.age_65_cents, lang))) } : null,
            summary.oas ? { label: words.facts.oas75, value: exact(words.monthly(formatMoney(summary.oas.age_75_cents, lang))) } : null,
            { label: words.facts.publisher, value: exact(words.publisher) },
            { label: words.facts.loaded, value: exact(dateLabel(summary.updated_at, lang)) }
        ],
        overviewHtml: twinLink(oasPath, lang) + paragraph(periodNote(period, lang, now)) +
            // Names and figures that may wrap, unlike the tables of bands.
            '<section><h2>' + escape(words.keyCaption(long)) + '</h2>' + htmlTable({ headers: words.keyHeaders, rows: keyRows, numeric: false }) + '</section>' +
            change + short,
        sources: officialLinks(lang),
        linksTitle: words.tablesTitle,
        links: summary.tables.map(entry => ({ path: oasTablePath(lang, entry.table), label: exact(tableTitle(entry.table, lang)),
            detail: exact(words.bands(count(entry.row_count, lang))) })),
        relatedTitle: words.filesTitle,
        relatedLinks: [datasetLink, ...summary.tables.map(entry => ({ path: '/resources/' + encodeURIComponent(entry.resource_id),
            label: words.fileLink(entry.table) }))],
        guides: guides(lang),
        labels: words.shell
    });
}

// ---- One table --------------------------------------------------------------------

// `number` is the page's table; `table` its bands, null until a quarter is loaded.
function oasTableMeta(number, table, lang) {
    const words = text(lang);
    const path = oasTablePath(lang, number);
    const name = tableTitle(number, lang);
    const crumbs = breadcrumbJsonLd(lang, [{ name: copy(lang).hub, path: oasPath(lang) }, { name, path }]);
    const shared = { canonical: seo.SITE_URL + path, lang: language(lang), ogType: 'website',
        alternates: alternates(code => oasTablePath(code, number)) };
    if (!table) return { ...shared, title: seo.fitTitle([name]) + ' - CanQuery', description: words.descriptionPlain, noindex: true, jsonLd: [crumbs] };
    const title = seo.fitTitleTiers([[words.tableTitles[number](periodLabel(table.period, lang, { short: true }))], [name]]);
    const long = periodLabel(table.period, lang);
    const description = fitDescription([words.tableDescriptions[number](long), words.tableDescriptionPlain(number, long)]);
    return { ...shared, title: title + ' - CanQuery', description,
        jsonLd: [crumbs, webPage({ lang, path, name: title, description, summary: { updated_at: table.period.loaded_at } })] };
}

// The bands of a table in sections of one round span of income (whole thousands of
// dollars, at most SECTIONS of them). A section is named by the income it starts at
// (its anchor is "income-" and that many dollars), so a link to "#income-18000" keeps
// its meaning from one quarter to the next; the band that holds that income opens the
// section. client/src/utils/oas.js makes the same sections.
function bandSections(rows) {
    if (!rows.length) return [];
    const end = rows[rows.length - 1][TO] + 1;
    const span = Math.max(1, Math.ceil(end / SECTIONS / 100000)) * 100000;
    const groups = [];
    for (const row of rows) {
        // The first round income the band holds, or the one before it when it holds none.
        const held = Math.ceil(row[FROM] / span) * span;
        const start = held <= row[TO] ? held : Math.floor(row[FROM] / span) * span;
        const last = groups[groups.length - 1];
        if (last && last.start === start) {
            last.rows.push(row);
            last.to = row[TO];
        } else {
            groups.push({ id: 'income-' + start / 100, start, from: row[FROM], to: row[TO], rows: [row] });
        }
    }
    return groups;
}

// `number` names the table of a page whose quarter is not loaded yet (table is then null).
function oasTableSnapshot(table, lang, { now = new Date(), number = null } = {}) {
    const words = text(lang);
    const shared = copy(lang);
    const hubCrumb = { path: oasPath(lang), label: shared.hub };
    const datasetLink = { path: '/datasets/' + OAS_DATASET_ID, label: words.datasetLink };
    if (!table) {
        const path = code => (number ? oasTablePath(code, number) : oasPath(code));
        return shell({ breadcrumbs: breadcrumbs(lang, [hubCrumb, { label: number ? exact(tableTitle(number, lang)) : shared.hub }]),
            title: exact(number ? tableTitle(number, lang) : words.headingPlain), lead: exact(shared.loading),
            overviewHtml: twinLink(path, lang), sources: officialLinks(lang), relatedTitle: words.filesTitle, relatedLinks: [datasetLink],
            guides: guides(lang), labels: words.shell });
    }
    const entry = table.table;
    const own = entry.table;
    const name = tableTitle(own, lang);
    const long = periodLabel(table.period, lang);
    const groups = bandSections(table.rows);
    const jump = '<nav aria-label="' + escape(words.jump) + '" data-cq-jump="true"><ul>' + groups.map(group =>
        '<li><a href="#' + group.id + '">' + escape(formatBand(group.from, group.to, lang)) + '</a></li>').join('') + '</ul></nav>';
    const headers = bandHeaders(own, lang);
    const sections = groups.map(group => '<section id="' + group.id + '"><h2>' + escape(words.range(formatBand(group.from, group.to, lang))) +
        '</h2>' + htmlTable({ headers, rows: group.rows.map(row => bandCells(own, row, lang)) }) + '</section>').join('');
    return shell({
        breadcrumbs: breadcrumbs(lang, [hubCrumb, { label: exact(shared.table + ' ' + own) }]),
        title: exact(name + ', ' + long),
        lead: exact(words.tableLead(name, long, lowerFirst(shared.income[own]), table.period.income_year) + ' ' + shared.caveat),
        facts: [
            { label: words.facts.quarter, value: exact(long) },
            { label: words.facts.incomeYear, value: table.period.income_year },
            { label: words.maximum[kind(own)], value: exact(words.monthly(formatMoney(entry.max_amount_cents, lang))) },
            hasAllowance(own) ? { label: words.maximum.allowance, value: exact(words.monthly(formatMoney(entry.max_allowance_cents, lang))) } : null,
            { label: words.endsAt, value: exact(formatDollars(entry.ends_at_cents, lang)) },
            { label: words.facts.bands, value: exact(count(entry.row_count, lang)) },
            hasPension(own) && table.oas ? { label: words.facts.oas65, value: exact(words.monthly(formatMoney(table.oas.age_65_cents, lang))) } : null,
            hasPension(own) && table.oas ? { label: words.facts.oas75, value: exact(words.monthly(formatMoney(table.oas.age_75_cents, lang))) } : null
        ],
        overviewHtml: twinLink(code => oasTablePath(code, own), lang) + paragraph(periodNote(table.period, lang, now)) + jump + sections,
        sources: officialLinks(lang),
        linksTitle: words.othersTitle,
        links: [...TABLE_NUMBERS.filter(other => other !== own).map(other => ({ path: oasTablePath(lang, other),
            label: exact(tableTitle(other, lang)) })), { path: oasPath(lang), label: shared.hubLong }],
        relatedTitle: words.filesTitle,
        relatedLinks: [{ path: '/resources/' + encodeURIComponent(entry.resource_id), label: words.fileLink(own) }, datasetLink],
        guides: guides(lang),
        labels: words.shell
    });
}

module.exports = { SECTIONS, TEXT, oasMeta, oasSnapshot, oasTableMeta, oasTableSnapshot, bandSections, periodNote, fitDescription };
