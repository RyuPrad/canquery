import { CATALOG_LIST_KEYS, toggleCatalogValue } from '../utils/catalogSearchState.js';

const LABEL_GROUPS = { org: 'organization', source: 'source' };

// One removable chip per active filter. Labels come from the facet counts
// when known, so a chip names the publisher rather than its identifier.
export function catalogChips(search, facets, { t, lang, places = [], includePlace = true }) {
  const named = (key, value) => {
    const group = LABEL_GROUPS[key];
    const hit = group && facets && facets[group] ? facets[group].find((item) => item.value === value) : null;
    return (hit && hit.label && (hit.label[lang] || hit.label.en || hit.label.fr)) || value;
  };
  const chips = [];
  if (includePlace && search.place) {
    const place = places.find((item) => item.slug === search.place || item.id === search.place);
    chips.push({ key: 'place', value: search.place, label: (place && (place.name?.[lang] || place.name?.en)) || search.place });
  }
  for (const key of CATALOG_LIST_KEYS) {
    for (const value of search[key]) {
      chips.push({ key, value, label: key === 'level' ? t('filters.level_' + value) : named(key, value) });
    }
  }
  if (search.queryable) chips.push({ key: 'queryable', value: 'true', label: t('filters.access_queryable') });
  if (search.mappable) chips.push({ key: 'mappable', value: 'true', label: t('filters.access_mappable') });
  return chips;
}

export function removeChip(search, chip) {
  if (chip.key === 'place') return { ...search, place: '' };
  if (chip.key === 'queryable' || chip.key === 'mappable') return { ...search, [chip.key]: false };
  return toggleCatalogValue(search, chip.key, chip.value);
}
