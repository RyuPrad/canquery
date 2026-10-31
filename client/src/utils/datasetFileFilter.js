// Narrowing one dataset's files in the browser. The dataset envelope already
// carries every file, so the search, year, format and language filters run in
// memory and keep the server's order. They are inputs, never links, so they
// open no crawl paths, and the server ignores these parameters.
import { fold } from './fold.js';

/**
 * @typedef {{ q: string, year: string, format: string, language: string }} FileFilter
 * @typedef {{ en?: string | null, fr?: string | null } | null | undefined} LocalizedText
 * @typedef {{
 *   name?: LocalizedText,
 *   format?: string | null,
 *   language?: string | string[] | null,
 *   presentation?: { title?: LocalizedText, formats?: string[], languages?: string[] } | null
 * }} DatasetFile
 * @typedef {{ file: DatasetFile, years: string[], format: string | null, languages: string[], text: string }} IndexedFile
 * @typedef {{ value: string, count: number }} FacetOption
 * @typedef {{ shown: boolean, options: FacetOption[] }} FacetGroup
 * @typedef {{ year: FacetGroup, format: FacetGroup, language: FacetGroup }} FileFacets
 * @typedef {'year' | 'format' | 'language'} FacetKey
 */

export const FILE_FILTER_KEYS = /** @type {const} */ (['q', 'year', 'format', 'language']);
/** @type {Readonly<FileFilter>} */
export const EMPTY_FILE_FILTER = Object.freeze({ q: '', year: '', format: '', language: '' });
export const FILE_LANGUAGES = ['en', 'fr', 'other'];
const MAX_QUERY = 200;
const YEAR_VALUE_RE = /^(?:19|20)\d{2}(?:-(?:\d{2}|(?:19|20)\d{2}))?$/;
const FORMAT_VALUE_RE = /^[A-Z0-9][A-Z0-9 ._+/-]{0,39}$/;

/**
 * The filter in the address bar; anything malformed reads as "no filter".
 * @param {URLSearchParams} params
 * @returns {FileFilter}
 */
export function readFileFilter(params) {
  const year = params.get('year') || '';
  const format = (params.get('format') || '').trim().toUpperCase();
  const language = params.get('language') || '';
  return {
    q: (params.get('q') || '').slice(0, MAX_QUERY),
    year: YEAR_VALUE_RE.test(year) ? year : '',
    format: FORMAT_VALUE_RE.test(format) ? format : '',
    language: FILE_LANGUAGES.includes(language) ? language : ''
  };
}

/**
 * Writes the filter and keeps every other parameter (page, highlight, …).
 * @param {URLSearchParams} params
 * @param {Partial<FileFilter>} filter
 * @returns {URLSearchParams}
 */
export function writeFileFilter(params, filter) {
  const next = new URLSearchParams(params);
  for (const key of FILE_FILTER_KEYS) {
    const raw = String(filter[key] || '');
    const value = key === 'q' ? (raw.trim() ? raw.slice(0, MAX_QUERY) : '') : raw;
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** @param {string} q */
function searchWords(q) {
  return fold(q).split(/\s+/).filter(Boolean);
}

/** @param {Partial<FileFilter>} filter */
export function hasFileFilter(filter) {
  return Boolean(
    searchWords(filter.q || '').length || filter.year || filter.format || filter.language
  );
}

/**
 * One key per distinct filter, for state that belongs to one filtered list.
 * @param {Partial<FileFilter>} filter
 */
export function fileFilterKey(filter) {
  return JSON.stringify([
    searchWords(filter.q || '').join(' '),
    filter.year || '',
    filter.format || '',
    filter.language || ''
  ]);
}

// The server's rule for a year in a file name (seoMeta.js fileYear), applied to
// names and titles: a year from 1900 to 2099 standing on its own, optionally
// followed by quarter marks (2022Q2, 2022T2) or a second year. The next year
// (2006-07, 2006-2007) makes a fiscal year and a later four-digit year a period
// (2031-2050); a digit run such as 20240115 or 100001 is not a year.
const YEAR_RE =
  /(?:^|[^a-z0-9])((?:19|20)\d{2})(?:[qt][1-4])*(?:[-–—_/]((?:19|20)\d{2}|\d{2}))?(?=$|[^a-z0-9])/gi;
// "FY2023-24" and the French AF/EF prefixes still name a fiscal year.
const FISCAL_PREFIX_RE = /(^|[^a-z0-9])(fy|af|ef)(?=(?:19|20)\d{2})/gi;
// A classification's edition is not a period: "NOC 2011", "(CNP) 2021", "NAICS 2017".
const EDITION_RE = /(?:^|[^a-z])(?:noc|cnp|naics|scian|napcs|scpan|sgc|cgt|cip|cpe)\)?[\s:-]*$/i;

/**
 * @param {number} start
 * @param {string | undefined} end
 */
function yearValue(start, end) {
  if (!end) return String(start);
  const next = end.length === 2 ? (start + 1) % 100 : start + 1;
  if (Number(end) === next) return start + '-' + String((start + 1) % 100).padStart(2, '0');
  if (end.length === 4 && Number(end) > start + 1) return start + '-' + end;
  return String(start);
}

/**
 * @param {unknown} text
 * @returns {{ value: string, at: number }[]}
 */
function yearTokens(text) {
  const source = String(text || '').replace(FISCAL_PREFIX_RE, '$1$2 ');
  const tokens = [];
  for (const match of source.matchAll(YEAR_RE)) {
    const at = (match.index ?? 0) + match[0].indexOf(match[1]);
    if (EDITION_RE.test(source.slice(0, at))) continue;
    tokens.push({ value: yearValue(Number(match[1]), match[2]), at });
  }
  return tokens;
}

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
function unique(values) {
  return [...new Set(values)];
}

/**
 * The years a file is about: a name that starts with a year is about that year
 * ("2002 Argentine", "2022Q2-Employers … (NOC) 2011 …"); otherwise every year its
 * names mention; otherwise the years its titles add that the dataset's own
 * title does not carry (the server adds a file name's year to same-named files).
 * @param {DatasetFile} file
 * @param {Set<string>} [datasetYears]
 * @returns {string[]}
 */
export function fileYears(file, datasetYears = new Set()) {
  const names = [file.name?.en, file.name?.fr].filter(
    /** @returns {name is string} */ (name) => typeof name === 'string' && name !== ''
  );
  for (const name of names) {
    const first = yearTokens(name)[0];
    if (first && /^[\s([{'"«]*$/.test(name.slice(0, first.at))) return [first.value];
  }
  const fromNames = unique(names.flatMap((name) => yearTokens(name).map((token) => token.value)));
  if (fromNames.length) return fromNames;
  const titles = [file.presentation?.title?.en, file.presentation?.title?.fr];
  return unique(titles.flatMap((title) => yearTokens(title).map((token) => token.value))).filter(
    (value) => !datasetYears.has(value)
  );
}

/** "2006-07" reads "2006–07". @param {string} value */
export function yearLabel(value) {
  return value.replace('-', '–');
}

/** @param {DatasetFile} file */
function fileFormat(file) {
  const formats = file.presentation?.formats;
  const raw = Array.isArray(formats) && formats.length ? formats[0] : file.format;
  const value = String(raw || '')
    .trim()
    .toUpperCase();
  return value || null;
}

const ENGLISH_RE = /^(en(?:[-_]ca)?|eng|english)$/;
const FRENCH_RE = /^(fr(?:[-_]ca)?|fra|fre|french|français)$/;

/**
 * English, French or both; anything else (zxx, a rare code, nothing) is "other".
 * The raw field is read like the server's resourceLanguages when no
 * presentation came with the file.
 * @param {DatasetFile} file
 * @returns {string[]}
 */
function fileLanguages(file) {
  const listed = file.presentation?.languages;
  /** @type {string[]} */
  let codes;
  if (Array.isArray(listed)) codes = listed.map(String);
  else {
    const raw = Array.isArray(file.language) ? file.language : [file.language];
    const parts = raw.flatMap((value) =>
      String(value || '')
        .toLowerCase()
        .split(/[,;|\s]+/)
    );
    codes = ['en', 'fr'].filter((lang) =>
      parts.some((code) => (lang === 'en' ? ENGLISH_RE : FRENCH_RE).test(code))
    );
  }
  const known = ['en', 'fr'].filter((lang) => codes.includes(lang));
  return known.length ? known : ['other'];
}

/**
 * Reads each file once: its years, format, languages and searchable text.
 * @param {DatasetFile[]} files
 * @param {LocalizedText[]} [datasetTitles] the dataset's own titles
 * @returns {IndexedFile[]}
 */
export function indexFiles(files, datasetTitles = []) {
  const datasetYears = new Set(
    datasetTitles
      .flatMap((title) => [title?.en, title?.fr])
      .flatMap((text) => yearTokens(text).map((token) => token.value))
  );
  return (files || []).map((file) => ({
    file,
    years: fileYears(file, datasetYears),
    format: fileFormat(file),
    languages: fileLanguages(file),
    text: fold(
      [file.presentation?.title?.en, file.presentation?.title?.fr, file.name?.en, file.name?.fr]
        .filter(Boolean)
        .join('\n')
    )
  }));
}

/**
 * @param {IndexedFile} entry
 * @param {Partial<FileFilter>} filter
 * @param {string[]} words
 * @param {FacetKey | null} except the group whose own choice is ignored
 */
function matches(entry, filter, words, except) {
  if (!words.every((word) => entry.text.includes(word))) return false;
  if (except !== 'year' && filter.year && !entry.years.includes(filter.year)) return false;
  if (except !== 'format' && filter.format && entry.format !== filter.format) return false;
  if (except !== 'language' && filter.language && !entry.languages.includes(filter.language))
    return false;
  return true;
}

/**
 * The files that match every part of the filter, in their original order.
 * @param {IndexedFile[]} indexed
 * @param {Partial<FileFilter>} filter
 * @returns {DatasetFile[]}
 */
export function filterFiles(indexed, filter) {
  const words = searchWords(filter.q || '');
  return indexed.filter((entry) => matches(entry, filter, words, null)).map((entry) => entry.file);
}

/** @param {string} value */
const yearStart = (value) => Number(value.slice(0, 4));

/** @type {Record<FacetKey, (a: string, b: string, totals: Map<string, number>) => number>} */
const ORDER = {
  // Newest first; a year before the fiscal year and period that start in it.
  year: (a, b) => yearStart(b) - yearStart(a) || a.length - b.length || a.localeCompare(b),
  format: (a, b, totals) => (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b),
  language: (a, b) => FILE_LANGUAGES.indexOf(a) - FILE_LANGUAGES.indexOf(b)
};

/** @type {Record<FacetKey, (entry: IndexedFile) => string[]>} */
const VALUES = {
  year: (entry) => entry.years,
  format: (entry) => (entry.format ? [entry.format] : []),
  language: (entry) => entry.languages
};

/**
 * @param {IndexedFile[]} indexed
 * @param {Partial<FileFilter>} filter
 * @param {string[]} words
 * @param {FacetKey} key
 * @returns {FacetGroup}
 */
function facetGroup(indexed, filter, words, key) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of indexed) {
    const values = VALUES[key](entry);
    for (const value of values) totals.set(value, (totals.get(value) || 0) + 1);
    if (!matches(entry, filter, words, key)) continue;
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  const selected = filter[key] || '';
  // A choice from the address that no file carries stays visible, so it can be cleared.
  if (selected && !totals.has(selected)) totals.set(selected, 0);
  const values = [...totals.keys()].sort((a, b) => ORDER[key](a, b, totals));
  const narrows = values.some((value) => (totals.get(value) || 0) < indexed.length);
  return {
    shown: Boolean(selected) || (values.length >= 2 && narrows),
    options: values.map((value) => ({ value, count: counts.get(value) || 0 }))
  };
}

/**
 * Each option counts the files that match the search and the other groups,
 * like the catalogue's facets; a group is shown only when it can narrow the list.
 * @param {IndexedFile[]} indexed
 * @param {Partial<FileFilter>} filter
 * @returns {FileFacets}
 */
export function fileFacets(indexed, filter) {
  const words = searchWords(filter.q || '');
  return {
    year: facetGroup(indexed, filter, words, 'year'),
    format: facetGroup(indexed, filter, words, 'format'),
    language: facetGroup(indexed, filter, words, 'language')
  };
}
