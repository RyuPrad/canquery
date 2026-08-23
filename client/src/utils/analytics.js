export const ANALYTICS_EVENTS = new Set([
  'catalog_search',
  'catalog_filter',
  'dataset_open',
  'place_search',
  'place_open',
  'place_source_open',
  'resource_open',
  'resource_query',
  'resource_filter',
  'resource_sort',
  'resource_view',
  'resource_page',
  'resource_load',
  'resource_export',
  'resource_download',
  'map_viewport',
  'map_feature_open',
  'chart_config',
  'carousel_navigate',
  'docs_action',
  'ui_language',
  'ui_theme',
  'outbound_link',
]);

const MAX_VALUE_LENGTH = 500;
const MAX_PROPERTIES = 24;

export function sanitizeAnalyticsProperties(properties = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(properties).slice(0, MAX_PROPERTIES)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value) || !Number.isFinite(value) && typeof value === 'number') continue;
    clean[key] = typeof value === 'string' ? value.slice(0, MAX_VALUE_LENGTH) : value;
  }
  return clean;
}

export function track(event, properties = {}) {
  if (!ANALYTICS_EVENTS.has(event)) return false;
  try {
    if (typeof globalThis.window?.umami?.track !== 'function') return false;
    globalThis.window.umami.track(event, sanitizeAnalyticsProperties(properties));
    return true;
  } catch {
    // Analytics is decorative: blocking, startup races and vendor failures must
    // never affect the product interaction that called this helper.
    return false;
  }
}
