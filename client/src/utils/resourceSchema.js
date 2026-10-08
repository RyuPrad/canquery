/** @param {import('../api/contracts').Field[] | undefined} fields */
export function schemaFingerprint(fields) {
  return Array.isArray(fields) ? JSON.stringify(fields.map(({ id, type }) => [id, type])) : null;
}

/** @param {Record<string, string>} filters @param {string | null} sort @param {import('../api/contracts').Field[] | undefined} fields */
export function reconcileResourceFields(filters, sort, fields) {
  if (!Array.isArray(fields)) return { filters, sort, changed: false };
  const names = new Set(['_id', ...fields.map(field => field.id)]);
  /** @type {Map<string, string | null>} */
  const aliases = new Map();
  for (const field of fields) {
    for (const alias of field.legacy_ids || []) {
      if (alias === '_id' || names.has(alias)) continue;
      aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== field.id ? null : field.id);
    }
  }
  /** @param {string} name */
  const resolve = name => names.has(name) ? name : aliases.get(name) || null;
  // A canonical filter wins when an old link supplies both it and an alias.
  const nextFilters = Object.fromEntries(Object.entries(filters).filter(([name]) => names.has(name)));
  for (const [name, value] of Object.entries(filters)) {
    const canonical = resolve(name);
    if (canonical && !Object.hasOwn(nextFilters, canonical)) nextFilters[canonical] = value;
  }
  let nextSort = sort;
  if (sort) {
    const exact = resolve(sort);
    const match = sort.match(/^(.*)\s+(asc|desc)$/i);
    const column = match && resolve(match[1]);
    nextSort = exact || (column ? `${column} ${match[2]}` : null);
  }
  const changed = nextSort !== sort || Object.keys(filters).length !== Object.keys(nextFilters).length ||
    Object.entries(filters).some(([name, value]) => nextFilters[name] !== value);
  return { filters: changed ? nextFilters : filters, sort: nextSort, changed };
}
