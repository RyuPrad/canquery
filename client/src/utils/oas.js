// The OAS benefit amounts pages (/oas and /fr/sv): the dataset, its five tables, and
// the number and period forms the pages print. Amounts are whole cents everywhere, so
// nothing is rounded twice; server/utils/oasLabels.js prints the same characters.

export const OAS_DATASET_ID = 'dfa4daf1-669e-4514-82cd-982f27707ed0';
export const OAS_TABLES = [1, 2, 3, 4, 5];

// The guide on reading the tables, in each language.
export const OAS_GUIDE = {
  en: '/blog/guaranteed-income-supplement-amounts',
  fr: '/fr/blog/supplement-revenu-garanti-tableau-montants'
};

// The official pages the publisher's own record points to, in each language.
export const OAS_OFFICIAL_LINKS = {
  en: [
    ['https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html', 'Old Age Security payment amounts (Canada.ca)'],
    ['https://estimateursv-oasestimator.digital.service.canada.ca/en', 'Old Age Security Benefits Estimator (Service Canada)'],
    ['https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement.html', 'Guaranteed Income Supplement (Canada.ca)'],
    ['https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/allowance.html', 'Allowance (Canada.ca)'],
    ['https://www.canada.ca/en/services/benefits/publicpensions/old-age-security.html', 'Old Age Security (Canada.ca)'],
    ['https://open.canada.ca/data/en/dataset/' + OAS_DATASET_ID, 'Employment and Social Development Canada on the Open Government Portal'],
    ['https://open.canada.ca/en/open-government-licence-canada', 'Open Government Licence - Canada']
  ],
  fr: [
    ['https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/paiements.html', 'Montant des paiements de la Sécurité de la vieillesse (Canada.ca)'],
    ['https://estimateursv-oasestimator.digital.service.canada.ca/fr', 'Estimateur des prestations de la Sécurité de la vieillesse (Service Canada)'],
    ['https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/supplement-revenu-garanti.html', 'Supplément de revenu garanti (Canada.ca)'],
    ['https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/supplement-revenu-garanti/allocation.html', 'Allocation (Canada.ca)'],
    ['https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse.html', 'Sécurité de la vieillesse (Canada.ca)'],
    ['https://ouvert.canada.ca/data/fr/dataset/' + OAS_DATASET_ID, 'Emploi et Développement social Canada sur le Portail du gouvernement ouvert'],
    ['https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada', 'Licence du gouvernement ouvert – Canada']
  ]
};

// A band is [income_from, income_to, amount, allowance, with_oas_65, with_oas_75], in cents.
export const FROM = 0;
export const TO = 1;
export const AMOUNT = 2;
export const ALLOWANCE = 3;
export const WITH_65 = 4;
export const WITH_75 = 5;

// Which amount a table's own column holds, and whether it has the others.
/** @param {number} table */
export const amountKind = (table) => (table === 5 ? 'survivor' : 'gis');
/** @param {number} table */
export const hasAllowance = (table) => table === 4;
/** @param {number} table */
export const hasPension = (table) => table !== 5;

const language = (lang) => (lang === 'fr' ? 'fr' : 'en');
const pad = (value) => String(value).padStart(2, '0');
// A no-break space: French numbers group thousands with one and put one before "$".
export const NBSP = String.fromCharCode(160);

// ---- Money --------------------------------------------------------------------

/**
 * "$1,138.90" / "1 138,90 $" from whole cents, written by hand so every browser
 * and the server print the same characters. `trim` drops the cents of a round amount.
 * @param {number} cents @param {string} lang @param {{ trim?: boolean }} [options]
 */
export function formatMoney(cents, lang, { trim = false } = {}) {
  const value = Math.round(Number(cents));
  if (!Number.isFinite(value)) return '';
  const fr = language(lang) === 'fr';
  const sign = value < 0 ? '-' : '';
  const whole = String(Math.trunc(Math.abs(value) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, fr ? NBSP : ',');
  const fraction = pad(Math.abs(value) % 100);
  const digits = trim && fraction === '00' ? whole : whole + (fr ? ',' : '.') + fraction;
  return fr ? sign + digits + NBSP + '$' : sign + '$' + digits;
}
/** A round dollar figure without its cents: "$23,112" / "23 112 $". @param {number} cents @param {string} lang */
export const formatDollars = (cents, lang) => formatMoney(cents, lang, { trim: true });
/** "$0.00 to $23.99" / "0,00 $ à 23,99 $". @param {number} from @param {number} to @param {string} lang */
export function formatBand(from, to, lang) {
  return formatMoney(from, lang) + (language(lang) === 'fr' ? ' à ' : ' to ') + formatMoney(to, lang);
}
/** "+2.3%" / "+2,3 %" between two amounts; '' when there is nothing to compare. */
export function formatChange(current, previous, lang) {
  if (!(previous > 0) || !Number.isFinite(current)) return '';
  const tenths = Math.round(((current - previous) / previous) * 1000);
  const fr = language(lang) === 'fr';
  const digits = Math.trunc(Math.abs(tenths) / 10) + (fr ? ',' : '.') + (Math.abs(tenths) % 10);
  return (tenths > 0 ? '+' : tenths < 0 ? '-' : '') + digits + (fr ? NBSP + '%' : '%');
}
/** "1,140" / "1 140". @param {number} value @param {string} lang */
export function formatCount(value, lang) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, language(lang) === 'fr' ? NBSP : ',');
}

// ---- Quarters -----------------------------------------------------------------

const QUARTERS = {
  en: {
    long: ['January to March', 'April to June', 'July to September', 'October to December'],
    short: ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec']
  },
  fr: {
    long: ['janvier à mars', 'avril à juin', 'juillet à septembre', 'octobre à décembre'],
    short: ['janv.–mars', 'avr.–juin', 'juill.–sept.', 'oct.–déc.']
  }
};
/**
 * "October to December 2026" / "octobre à décembre 2026".
 * @param {{ quarter: number, year: number } | null | undefined} period @param {string} lang @param {{ short?: boolean }} [options]
 */
export function periodLabel(period, lang, { short = false } = {}) {
  if (!period || !(period.quarter >= 1 && period.quarter <= 4)) return '';
  return QUARTERS[language(lang)][short ? 'short' : 'long'][period.quarter - 1] + ' ' + period.year;
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
};
/** "January 1, 2027" / "1er janvier 2027", from a YYYY-MM-DD date. @param {string} date @param {string} lang */
export function dateLabel(date, lang) {
  const [year, month, day] = String(date || '').slice(0, 10).split('-').map(Number);
  if (!year || !(month >= 1 && month <= 12) || !day) return '';
  return language(lang) === 'fr'
    ? `${day === 1 ? '1er' : day} ${MONTHS.fr[month - 1]} ${year}`
    : `${MONTHS.en[month - 1]} ${day}, ${year}`;
}

/** The visitor's date as YYYY-MM-DD. @param {Date} [now] */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
/**
 * Whether a quarter has not started yet, is the one in effect or has ended.
 * @param {{ start: string, end: string } | null | undefined} period @param {string} day YYYY-MM-DD
 * @returns {'upcoming' | 'current' | 'ended'}
 */
export function periodState(period, day) {
  if (!period || !day) return 'current';
  return day < period.start ? 'upcoming' : day > period.end ? 'ended' : 'current';
}

// ---- Income -------------------------------------------------------------------

const SPACES = new RegExp('[\\s' + NBSP + String.fromCharCode(0x202f) + ']', 'g');
/**
 * The yearly income a visitor typed, in cents. Accepts "18000", "18,000", "18,000.50",
 * "18 000", "18000,50" and a "$" on either side; anything else is invalid, including
 * "18.000", which could be read two ways. An empty box is not an error.
 * @param {string} text
 * @returns {{ cents: number } | { empty: true } | { invalid: true }}
 */
export function parseIncome(text) {
  const value = String(text == null ? '' : text).replace(SPACES, '').replace(/^\$|\$$/g, '');
  if (value === '') return { empty: true };
  // Commas that group thousands, with a point before the cents; or no grouping, with a point or a comma.
  const match = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(value) || /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return { invalid: true };
  const whole = match[1].replace(/,/g, '');
  const fraction = match[2] || '';
  if (whole.replace(/^0+(?=\d)/, '').length > 9) return { invalid: true };
  return { cents: Number(whole) * 100 + Number(fraction.padEnd(2, '0')) };
}

/**
 * The band that holds a yearly income, by binary search; null when no band does.
 * @param {number[][]} rows @param {number} cents
 */
export function findBand(rows, cents) {
  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cents < rows[middle][FROM]) high = middle - 1;
    else if (cents > rows[middle][TO]) low = middle + 1;
    else return { row: rows[middle], line: middle + 1 };
  }
  return null;
}

// A table's page shows its bands in this many sections, each under its income range
// (the server's HTML has the same sections, so the page keeps its shape when the
// application draws over it).
export const BAND_SECTIONS = 12;
/** @param {number[][]} rows */
export function bandSections(rows) {
  const size = Math.max(1, Math.ceil(rows.length / BAND_SECTIONS));
  const groups = [];
  for (let start = 0; start < rows.length; start += size) {
    const part = rows.slice(start, start + size);
    groups.push({ id: 'income-' + Math.floor(part[0][FROM] / 100), from: part[0][FROM], to: part[part.length - 1][TO], first: start + 1, rows: part });
  }
  return groups;
}
