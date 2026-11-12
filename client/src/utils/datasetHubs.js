import { LMIA_DATASET_ID } from './lmia.js';
import { OAS_DATASET_ID } from './oas.js';
import { oasPath } from './localizedRoutes.js';

// Datasets with a page of their own built from their files: the dataset's page and
// each of its file pages lead to it. `marker` names a hub that is linked only on a
// site where it has data (the server says so with a meta element in the head).
export const HUBS_MARKER = 'cq-hubs';

/** @type {Record<string, { path: (lang: string) => string, text: string, link: string, marker: string | null }>} */
const HUBS = {
  [LMIA_DATASET_ID]: { path: () => '/lmia', text: 'lmia.dataset_callout', link: 'lmia.dataset_callout_link', marker: null },
  [OAS_DATASET_ID]: { path: (lang) => oasPath(lang), text: 'oas.dataset_callout', link: 'oas.dataset_callout_link', marker: 'oas' }
};

/** Whether this site's server reported data for a hub. @param {string} name @param {Document} [doc] */
export function hubHasData(name, doc = document) {
  const content = doc.querySelector('meta[name="' + HUBS_MARKER + '"]')?.getAttribute('content') || '';
  return content.split(/[\s,]+/).includes(name);
}

/** The hub of a dataset, when it has one that can be linked here; otherwise null. @param {string | null | undefined} datasetId @param {Document} [doc] */
export function datasetHub(datasetId, doc = document) {
  const hub = datasetId && Object.hasOwn(HUBS, datasetId) ? HUBS[datasetId] : null;
  return hub && (hub.marker === null || hubHasData(hub.marker, doc)) ? hub : null;
}
