// Names for the positive LMIA employers list pages (/lmia), in English and French.

export const LMIA_DATASET_ID = '90fed587-1364-4f33-a9ee-208181dc0b97';

// The guide on checking an employer, in each language.
export const LMIA_GUIDE = { en: '/blog/check-employer-positive-lmia', fr: '/fr/blog/verifier-employeur-eimt-positive' };

/** @type {[string, string, string][]} code, English, French */
export const LMIA_PROVINCES = [
  ['NL', 'Newfoundland and Labrador', 'Terre-Neuve-et-Labrador'],
  ['PE', 'Prince Edward Island', 'Île-du-Prince-Édouard'],
  ['NS', 'Nova Scotia', 'Nouvelle-Écosse'],
  ['NB', 'New Brunswick', 'Nouveau-Brunswick'],
  ['QC', 'Quebec', 'Québec'],
  ['ON', 'Ontario', 'Ontario'],
  ['MB', 'Manitoba', 'Manitoba'],
  ['SK', 'Saskatchewan', 'Saskatchewan'],
  ['AB', 'Alberta', 'Alberta'],
  ['BC', 'British Columbia', 'Colombie-Britannique'],
  ['YT', 'Yukon', 'Yukon'],
  ['NT', 'Northwest Territories', 'Territoires du Nord-Ouest'],
  ['NU', 'Nunavut', 'Nunavut'],
  ['HO', 'Head office outside Canada', 'Siège social à l’extérieur du Canada']
];

/** @param {string | null | undefined} code @param {string} lang */
export function provinceName(code, lang) {
  const found = LMIA_PROVINCES.find(([value]) => value === code);
  return found ? (lang === 'fr' ? found[2] : found[1]) : code || '';
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
};

/**
 * "Q2 2026" or "T2 2026", "January to June 2017", "2016", "June 20 to December 31,
 * 2014", from a period with kind/start/end or the period_ fields.
 * @param {{ kind?: string, start?: string, end?: string, period_kind?: string, period_start?: string, period_end?: string } | null | undefined} period
 * @param {string} lang
 */
export function lmiaPeriodLabel(period, lang) {
  if (!period) return '';
  const fr = lang === 'fr';
  const kind = period.kind || period.period_kind;
  const [year, startMonth, startDay] = String(period.start || period.period_start || '').split('-').map(Number);
  const [, endMonth, endDay] = String(period.end || period.period_end || '').split('-').map(Number);
  if (!year || !startMonth || !endMonth) return '';
  const months = MONTHS[fr ? 'fr' : 'en'];
  if (kind === 'quarter') return (fr ? 'T' : 'Q') + Math.ceil(endMonth / 3) + ' ' + year;
  if (kind === 'year' && startMonth === 1 && startDay === 1 && endMonth === 12 && endDay === 31) return String(year);
  if (kind === 'year') {
    return fr
      ? `du ${startDay === 1 ? '1er' : startDay} ${months[startMonth - 1]} au ${endDay === 1 ? '1er' : endDay} ${months[endMonth - 1]} ${year}`
      : `${months[startMonth - 1]} ${startDay} to ${months[endMonth - 1]} ${endDay}, ${year}`;
  }
  return fr ? `de ${months[startMonth - 1]} à ${months[endMonth - 1]} ${year}` : `${months[startMonth - 1]} to ${months[endMonth - 1]} ${year}`;
}

/** @param {number | null | undefined} value @param {string} lang */
export function formatCount(value, lang) {
  return Number(value || 0).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
}

const STREAMS_FR = {
  'High Wage': 'Volet des postes à haut salaire',
  'Low Wage': 'Volet des postes à bas salaire',
  'Primary Agriculture': 'Volet de l’agriculture primaire',
  'Global Talent Stream': 'Volet des talents mondiaux',
  'Permanent Resident Only': 'Résidence permanente seulement',
  'Unspecified': 'Non précisé'
};

/** The publisher's English stream name, in French when it has one. @param {string} stream @param {string} lang */
export function streamName(stream, lang) {
  return lang === 'fr' ? STREAMS_FR[stream] || stream : stream;
}
