import { fold } from './fold.js';

// The portal directory's own reading of its rows: names in the reader's
// language, the filters above the table and its sort. No request: the page
// holds every portal.

/** The catalogue software behind a portal; anything else is shown as "other". */
export const PLATFORM_NAMES = { ckan: 'CKAN', 'arcgis-hub': 'ArcGIS Hub', socrata: 'Socrata', opendatasoft: 'Opendatasoft' };
export const LEVELS = ['federal', 'provincial', 'municipal'];
export const SORT_KEYS = ['datasets', 'name', 'tables', 'maps', 'read'];

const locale = (lang) => (lang === 'fr' ? 'fr-CA' : 'en-CA');

/** @param {number} value @param {string} lang */
export const formatCount = (value, lang) => Number(value).toLocaleString(locale(lang));

/** A name in the reader's language, with the other one as a fallback. @param {{ en?: string | null, fr?: string | null } | null | undefined} name @param {string} lang */
export const localName = (name, lang) => (name ? (lang === 'fr' ? name.fr || name.en : name.en || name.fr) || '' : '');

/** The day a portal was last read, as the reader's language writes it (the day in UTC). @param {string | null} iso @param {string} lang */
export function dayLabel(iso, lang) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale(lang), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Where a portal's datasets are listed in the catalogue, optionally only those with a table or a map. @param {string} id @param {'queryable' | 'mappable'} [only] */
export function cataloguePath(id, only) {
  const params = new URLSearchParams({ source: id });
  if (only) params.set(only, 'true');
  return '/datasets?' + params.toString();
}

/**
 * The portals that match the filters. Text is matched without case or accents
 * against the portal's name in both languages, its place and its province.
 * @param {any[]} portals
 * @param {{ q?: string, level?: string, platform?: string, province?: string }} filters
 */
export function filterPortals(portals, { q = '', level = '', platform = '', province = '' } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return portals.filter((portal) => {
    if (level && portal.level !== level) return false;
    if (platform && portal.platform !== platform) return false;
    if (province && (!portal.province || portal.province.slug !== province)) return false;
    if (!words.length) return true;
    const text = fold([portal.name.en, portal.name.fr, portal.place?.name.en, portal.place?.name.fr,
      portal.province?.name.en, portal.province?.name.fr].filter(Boolean).join(' '));
    return words.every((word) => text.includes(word));
  });
}

/**
 * The portals in the order a column asks for. Numbers and dates start with the
 * largest and the latest, names with A; ties keep the directory's own order
 * (most datasets first). A portal never read sorts after every date.
 * @param {any[]} portals
 * @param {{ key?: string, descending?: boolean }} sort
 * @param {string} lang
 */
export function sortPortals(portals, { key = 'datasets', descending = key !== 'name' } = {}, lang = 'en') {
  const collator = new Intl.Collator(locale(lang), { sensitivity: 'base', numeric: true });
  const value = {
    datasets: (portal) => portal.datasets,
    tables: (portal) => portal.tables,
    maps: (portal) => portal.maps,
    read: (portal) => (portal.last_synced_at ? Date.parse(portal.last_synced_at) || null : null)
  }[key];
  const direction = descending ? -1 : 1;
  return portals
    .map((portal, index) => ({ portal, index }))
    .sort((a, b) => {
      let order;
      if (key === 'name') {
        order = collator.compare(localName(a.portal.name, lang), localName(b.portal.name, lang)) * direction;
      } else {
        const [left, right] = [value(a.portal), value(b.portal)];
        // Nothing to compare by goes last in either direction.
        if (left === null || right === null) order = left === right ? 0 : left === null ? 1 : -1;
        else order = (left - right) * direction;
      }
      return order || a.index - b.index;
    })
    .map(({ portal }) => portal);
}
