// Pages that live at one address per language: the OAS benefit amounts hub and its
// table pages (/oas ↔ /fr/sv, /oas/table-N ↔ /fr/sv/tableau-N). Their language is
// the address's, as for guides; unlike a guide's, the other address is a pure
// function of this one, so no page has to announce it.

const OAS_EN = /^\/oas(?:\/table-([1-5]))?\/?$/i;
const OAS_FR = /^\/fr\/sv(?:\/tableau-([1-5]))?\/?$/i;

/** The hub's address in a language, or a table page's. @param {string} language @param {number | null} [table] */
export function oasPath(language, table = null) {
  const fr = language === 'fr';
  if (table === null || table === undefined) return fr ? '/fr/sv' : '/oas';
  return fr ? '/fr/sv/tableau-' + table : '/oas/table-' + table;
}

/** What an OAS address names: its language and table (null for the hub); null for any other address. @param {string} pathname */
export function oasRoute(pathname) {
  const en = OAS_EN.exec(pathname || '');
  if (en) return { language: 'en', table: en[1] ? Number(en[1]) : null };
  const fr = OAS_FR.exec(pathname || '');
  return fr ? { language: 'fr', table: fr[1] ? Number(fr[1]) : null } : null;
}

/** The language an address is written in, or null when the address has none of its own. @param {string} pathname */
export function routeLanguage(pathname) {
  return oasRoute(pathname)?.language || null;
}

/** The same page in another language, or null when the address has no twin. @param {string} pathname @param {string} language */
export function translatedPath(pathname, language) {
  const route = oasRoute(pathname);
  return route ? oasPath(language, route.table) : null;
}
