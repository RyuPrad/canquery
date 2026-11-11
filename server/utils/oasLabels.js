// The OAS benefit amounts dataset ("Old Age Security (OAS) - Table of Benefit Amounts by
// marital status and income level", Employment and Social Development Canada): its five
// tables, the quarters they cover, and the English and French words and number forms the
// server's HTML uses for them. Table and column wording follows the publisher's data
// dictionary. The client has the same words in client/src/i18n.jsx (a test compares them).
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
const TABLE_NUMBERS = Object.freeze([1, 2, 3, 4, 5]);

const pad = value => String(value).padStart(2, '0');
const language = lang => (lang === 'fr' ? 'fr' : 'en');
// A no-break space: French numbers group thousands with one and put one before "$".
const NBSP = String.fromCharCode(160);

// ---- Quarters ---------------------------------------------------------------------

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

const QUARTERS = {
    en: { long: ['January to March', 'April to June', 'July to September', 'October to December'],
        short: ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'] },
    fr: { long: ['janvier à mars', 'avril à juin', 'juillet à septembre', 'octobre à décembre'],
        short: ['janv.–mars', 'avr.–juin', 'juill.–sept.', 'oct.–déc.'] }
};
// "October to December 2026" / "octobre à décembre 2026"; short: "Oct–Dec 2026" / "oct.–déc. 2026".
function periodLabel(period, lang, { short = false } = {}) {
    if (!period || !(period.quarter >= 1 && period.quarter <= 4)) return '';
    return QUARTERS[language(lang)][short ? 'short' : 'long'][period.quarter - 1] + ' ' + period.year;
}

const MONTHS = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
};
// "January 1, 2027" / "1er janvier 2027", from a YYYY-MM-DD date.
function dateLabel(date, lang) {
    const [year, month, day] = String(date || '').slice(0, 10).split('-').map(Number);
    if (!year || !(month >= 1 && month <= 12) || !day) return '';
    return language(lang) === 'fr' ? `${day === 1 ? '1er' : day} ${MONTHS.fr[month - 1]} ${year}`
        : `${MONTHS.en[month - 1]} ${day}, ${year}`;
}

// Whether a quarter has not started yet, is the one in effect or has ended, on a
// day given as YYYY-MM-DD.
function periodState(period, today) {
    if (!period || !today) return 'current';
    return today < period.start ? 'upcoming' : today > period.end ? 'ended' : 'current';
}
// Today's date where the benefits are paid, as YYYY-MM-DD.
function todayInCanada(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ---- Money ------------------------------------------------------------------------

// "$1,138.90" / "1 138,90 $" from whole cents, written by hand so the server and every
// browser print the same characters.
function formatMoney(cents, lang, { trim = false } = {}) {
    const value = Math.round(Number(cents));
    if (!Number.isFinite(value)) return '';
    const fr = language(lang) === 'fr';
    const sign = value < 0 ? '-' : '';
    const whole = String(Math.trunc(Math.abs(value) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, fr ? NBSP : ',');
    const fraction = pad(Math.abs(value) % 100);
    const digits = trim && fraction === '00' ? whole : whole + (fr ? ',' : '.') + fraction;
    return fr ? sign + digits + NBSP + '$' : sign + '$' + digits;
}
// A round dollar figure without its cents: "$23,112" / "23 112 $".
const formatDollars = (cents, lang) => formatMoney(cents, lang, { trim: true });
// "$0.00 to $23.99" / "0,00 $ à 23,99 $".
function formatBand(from, to, lang) {
    return formatMoney(from, lang) + (language(lang) === 'fr' ? ' à ' : ' to ') + formatMoney(to, lang);
}
// "+2.3%" / "+2,3 %" for a change between two amounts; '' when there is nothing to compare.
function formatChange(current, previous, lang) {
    if (!(previous > 0) || !Number.isFinite(current)) return '';
    const tenths = Math.round(((current - previous) / previous) * 1000);
    const fr = language(lang) === 'fr';
    const digits = Math.trunc(Math.abs(tenths) / 10) + (fr ? ',' : '.') + (Math.abs(tenths) % 10);
    return (tenths > 0 ? '+' : tenths < 0 ? '-' : '') + digits + (fr ? NBSP + '%' : '%');
}

// ---- Paths ------------------------------------------------------------------------

const oasPath = lang => (language(lang) === 'fr' ? '/fr/sv' : '/oas');
function oasTablePath(lang, table) {
    return language(lang) === 'fr' ? '/fr/sv/tableau-' + table : '/oas/table-' + table;
}

// ---- Words ------------------------------------------------------------------------

const COPY = {
    en: {
        hub: 'OAS and GIS amounts',
        hubLong: 'OAS and GIS amounts by income',
        dataset: 'OAS: Table of Benefit Amounts',
        datasets: 'Datasets',
        table: 'Table',
        tables: {
            1: 'GIS for a single person who receives an OAS pension',
            2: 'GIS for the spouse or common-law partner of someone who receives an OAS pension',
            3: 'GIS for the spouse or common-law partner of someone who does not receive an OAS pension',
            4: 'GIS and Allowance for a couple',
            5: 'Allowance for the Survivor'
        },
        situations: {
            1: 'Single, widowed or divorced, receiving the OAS pension',
            2: 'Spouse or common-law partner receives the full OAS pension',
            3: 'Spouse or common-law partner receives neither the OAS pension nor the Allowance',
            4: 'Spouse or common-law partner receives the Allowance',
            5: 'Surviving spouse or common-law partner, age 60 to 64'
        },
        income: {
            1: 'Yearly income of the beneficiary (excluding OAS pension and GIS)',
            2: 'Combined yearly income of the couple (excluding OAS pension and GIS)',
            3: 'Combined yearly income of the couple (excluding OAS pension and GIS)',
            4: 'Combined yearly income of the couple (excluding OAS pension, GIS and Allowance)',
            5: 'Yearly income of the beneficiary (excluding Allowance for the Survivor)'
        },
        columns: {
            income: 'Yearly income', gis: 'Monthly GIS', survivor: 'Monthly Allowance for the Survivor',
            allowance: 'Monthly Allowance', with65: 'OAS pension and GIS, age 65 to 74', with75: 'OAS pension and GIS, age 75 and over'
        },
        caveat: 'These are the amounts Employment and Social Development Canada publishes for people who receive the full ' +
            'Old Age Security pension. Your own payment can differ, for example with a partial pension or a change in your ' +
            'situation, and Service Canada decides it. CanQuery is not a government website.',
        private: 'The lookup runs in your browser: the income you type is never sent to CanQuery or anyone else.',
        loading: 'The tables of OAS benefit amounts are being loaded. Until then, each official file is on the dataset page.',
        upcoming: 'These amounts apply from {date}.',
        ended: 'These are the amounts for {period}. Newer amounts may have been published since; CanQuery shows them as soon as Employment and Social Development Canada publishes its files.',
        twin: 'Lire en français',
        twinLang: 'fr'
    },
    fr: {
        hub: 'Montants de la SV et du SRG',
        hubLong: 'Montants de la SV et du SRG selon le revenu',
        dataset: 'SV : Tableau des montants des prestations',
        datasets: 'Jeux de données',
        table: 'Tableau',
        tables: {
            1: 'SRG pour un bénéficiaire célibataire qui reçoit la pension de la SV',
            2: 'SRG pour l’époux ou le conjoint de fait d’une personne qui reçoit la pension de la SV',
            3: 'SRG pour l’époux ou le conjoint de fait d’une personne qui ne reçoit pas la pension de la SV',
            4: 'SRG et Allocation pour un couple',
            5: 'Allocation au survivant'
        },
        situations: {
            1: 'Célibataire, veuf ou divorcé, recevant la pension de la SV',
            2: 'L’époux ou le conjoint de fait reçoit la pleine pension de la SV',
            3: 'L’époux ou le conjoint de fait ne reçoit ni la pension de la SV ni l’Allocation',
            4: 'L’époux ou le conjoint de fait reçoit l’Allocation',
            5: 'Époux ou conjoint de fait survivant, de 60 à 64 ans'
        },
        income: {
            1: 'Revenu annuel du bénéficiaire (excluant la pension de la SV et le SRG)',
            2: 'Revenu annuel combiné du couple (excluant la pension de la SV et le SRG)',
            3: 'Revenu annuel combiné du couple (excluant la pension de la SV et le SRG)',
            4: 'Revenu annuel combiné du couple (excluant la pension de la SV, le SRG et l’Allocation)',
            5: 'Revenu annuel du bénéficiaire (excluant l’Allocation au survivant)'
        },
        columns: {
            income: 'Revenu annuel', gis: 'SRG mensuel', survivor: 'Allocation au survivant mensuelle',
            allowance: 'Allocation mensuelle', with65: 'Pension de la SV et SRG, 65 à 74 ans', with75: 'Pension de la SV et SRG, 75 ans et plus'
        },
        caveat: 'Ce sont les montants qu’Emploi et Développement social Canada publie pour les personnes qui reçoivent la ' +
            'pleine pension de la Sécurité de la vieillesse. Votre paiement peut différer, par exemple avec une pension ' +
            'partielle ou un changement de situation, et c’est Service Canada qui le détermine. CanQuery n’est pas un site ' +
            'du gouvernement.',
        private: 'La recherche se fait dans votre navigateur : le revenu que vous entrez n’est jamais envoyé à CanQuery ni à personne.',
        loading: 'Les tableaux des montants des prestations de la SV sont en cours de chargement. D’ici là, chaque fichier officiel se trouve sur la page du jeu de données.',
        upcoming: 'Ces montants s’appliquent à compter du {date}.',
        ended: 'Ce sont les montants de {period}. De nouveaux montants ont peut-être été publiés depuis; CanQuery les affiche dès qu’Emploi et Développement social Canada publie ses fichiers.',
        twin: 'Read in English',
        twinLang: 'en'
    }
};
const copy = lang => COPY[language(lang)];
// "Table 1: GIS for a single person…" / "Tableau 1 : SRG pour un bénéficiaire…".
function tableTitle(table, lang) {
    const words = copy(lang);
    return words.table + ' ' + table + (language(lang) === 'fr' ? ' : ' : ': ') + words.tables[table];
}

// The official pages the publisher's own record points to, in each language.
const OFFICIAL_LINKS = {
    en: [
        { path: 'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html',
            label: 'Old Age Security payment amounts (Canada.ca)' },
        { path: 'https://estimateursv-oasestimator.digital.service.canada.ca/en', label: 'Old Age Security Benefits Estimator (Service Canada)' },
        { path: 'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement.html',
            label: 'Guaranteed Income Supplement (Canada.ca)' },
        { path: 'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/allowance.html',
            label: 'Allowance (Canada.ca)' },
        { path: 'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security.html', label: 'Old Age Security (Canada.ca)' },
        { path: 'https://open.canada.ca/data/en/dataset/' + OAS_DATASET_ID,
            label: 'Employment and Social Development Canada on the Open Government Portal' },
        { path: 'https://open.canada.ca/en/open-government-licence-canada', label: 'Open Government Licence - Canada' }
    ],
    fr: [
        { path: 'https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/paiements.html',
            label: 'Montant des paiements de la Sécurité de la vieillesse (Canada.ca)' },
        { path: 'https://estimateursv-oasestimator.digital.service.canada.ca/fr',
            label: 'Estimateur des prestations de la Sécurité de la vieillesse (Service Canada)' },
        { path: 'https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/supplement-revenu-garanti.html',
            label: 'Supplément de revenu garanti (Canada.ca)' },
        { path: 'https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/supplement-revenu-garanti/allocation.html',
            label: 'Allocation (Canada.ca)' },
        { path: 'https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse.html',
            label: 'Sécurité de la vieillesse (Canada.ca)' },
        { path: 'https://ouvert.canada.ca/data/fr/dataset/' + OAS_DATASET_ID,
            label: 'Emploi et Développement social Canada sur le Portail du gouvernement ouvert' },
        { path: 'https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada', label: 'Licence du gouvernement ouvert – Canada' }
    ]
};
const officialLinks = lang => OFFICIAL_LINKS[language(lang)];

module.exports = {
    OAS_DATASET_ID, OAS_TABLES, TABLE_NUMBERS, NBSP, periodKey, periodOf, periodLabel, dateLabel, periodState, todayInCanada,
    formatMoney, formatDollars, formatBand, formatChange, oasPath, oasTablePath, copy, tableTitle, officialLinks
};
