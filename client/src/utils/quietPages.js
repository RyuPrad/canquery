import { oasRoute } from './localizedRoutes.js';

// Pages where a click or the scroll position says something about the visitor: on the
// OAS amounts pages the row a visitor looks up is the row of their income, so where
// they click or how far the page has scrolled gives that income away. The heatmap
// recorder (click coordinates, scroll depth) is never loaded with one of these pages,
// and a page of this kind reached inside the application after the recorder was
// loaded starts again as its own document, without it. Page views and the lookup's
// own count (which table, never an amount) are still recorded.

const FLAG = '__cqHeatmaps';

/** @param {string} pathname */
export const isQuietPath = (pathname) => Boolean(oasRoute(pathname || ''));
/** Called when the recorder's script is added to this document. @param {any} [win] */
export const markRecorderLoaded = (win = globalThis.window) => { if (win) win[FLAG] = true; };
/** Whether this document has the recorder. @param {any} [win] */
export const recorderLoaded = (win = globalThis.window) => Boolean(win && win[FLAG] === true);
/** Loads the current address again as a new document (the history entry and its state stay). @param {any} [win] */
export const reloadDocument = (win = globalThis.window) => { win.location.reload(); };
