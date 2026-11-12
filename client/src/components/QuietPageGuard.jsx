import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isQuietPath, reloadDocument, siteHasTrackers } from '../utils/quietPages.js';

// Whether this document opened on a quiet page (utils/quietPages.js): it then has
// neither the ad loader nor the heatmap recorder.
const OPENED_QUIET = typeof window !== 'undefined' && isQuietPath(window.location.pathname);

/**
 * A document that opened on a quiet page serves quiet pages only. Another page reached
 * from it inside the application is loaded as its own document, so that it has the ads
 * and the recorder every other visit to it has. (The other direction, a quiet page
 * reached from a document that carries them, is the quiet page's own doing: it must
 * not draw anything first.) On a site with neither ads nor analytics nothing is reloaded.
 * @param {{ openedQuiet?: boolean }} props
 */
export default function QuietPageGuard({ openedQuiet = OPENED_QUIET }) {
  const { pathname } = useLocation();
  const quiet = isQuietPath(pathname);
  useEffect(() => {
    if (openedQuiet && !quiet && siteHasTrackers()) reloadDocument();
  }, [openedQuiet, quiet]);
  return null;
}
