import { oasRoute } from './localizedRoutes.js';

// Quiet pages: the OAS amounts hub and its table pages, where a visitor types an income
// and the row they look up is the row of that income. Two things stay out of a document
// that shows one:
// - the heatmap recorder (click coordinates, scroll depth): where the visitor clicks, or
//   how far the page scrolled to the marked row, would give the income away;
// - the ad loader, a third party's script: the server leaves it out of these pages' HTML.
// A document serves quiet pages or the others, never both: a quiet page reached inside
// the application from a document that carries either starts again as its own document,
// and so does another page reached from a document that opened on a quiet one (it would
// otherwise go without the ads and the recorder every other visit to it has). Page views
// and the lookup's own count (which table, never an amount) are still recorded.

const FLAG = '__cqHeatmaps';

/** @param {string} pathname */
export const isQuietPath = (pathname) => Boolean(oasRoute(pathname || ''));
/** Called when the recorder's script is added to this document. @param {any} [win] */
export const markRecorderLoaded = (win = globalThis.window) => { if (win) win[FLAG] = true; };
/** Whether this document has the recorder. @param {any} [win] */
export const recorderLoaded = (win = globalThis.window) => Boolean(win && win[FLAG] === true);
/** Whether this document has the ad loader (in the HTML of every page that shows ads). @param {Document} [doc] */
export const adsLoaded = (doc = globalThis.document) => Boolean(doc && doc.querySelector('script[src^="https://pagead2.googlesyndication.com/"]'));
/** Whether this document carries what a quiet page must not. @param {any} [win] @param {Document} [doc] */
export const carriesTrackers = (win = globalThis.window, doc = globalThis.document) => recorderLoaded(win) || adsLoaded(doc);
/** Whether the site shows ads or records heatmaps at all: its pages say so in their head. @param {Document} [doc] */
export const siteHasTrackers = (doc = globalThis.document) =>
  Boolean(doc && doc.querySelector('meta[name="google-adsense-account"], meta[name="canquery-analytics-site"]'));
/** Loads the current address again as a new document (the history entry and its state stay). @param {any} [win] */
export const reloadDocument = (win = globalThis.window) => { win.location.reload(); };
