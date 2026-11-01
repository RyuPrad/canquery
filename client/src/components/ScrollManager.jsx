import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import {
  createScrollMemory,
  documentWasRestored,
  entryKey,
  entryPath,
  restoreScroll,
  scrollAction
} from '../utils/scrollMemory.js';

const sharedMemory = createScrollMemory();
const restoredDocument = documentWasRestored();

const setRestoration = (mode) => {
  try {
    window.history.scrollRestoration = mode;
  } catch {
    // Older browsers keep their own behaviour.
  }
};

// Owns the window's scroll position across in-app navigation (scrollAction in
// utils/scrollMemory.js says what each change does). The browser's own
// restoration is off while the app runs: it restores before React draws the
// page it returns to, so it lands at the wrong place or is overwritten. It is
// switched back on when the page is hidden, so a reload or a later Back to
// this document starts from the browser's position until this takes over.
export default function ScrollManager({ memory = sharedMemory, restored = restoredDocument }) {
  const location = useLocation();
  const type = useNavigationType();
  const current = useRef(null);
  const restoring = useRef(null);

  useEffect(() => {
    const record = () => {
      if (current.current && !restoring.current) {
        memory.set(current.current.key, current.current.path, window.scrollY);
      }
    };
    const save = () => {
      record();
      memory.save();
    };
    const hide = () => {
      save();
      setRestoration('auto');
    };
    const show = (event) => {
      if (event.persisted) setRestoration('manual');
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') save();
    };
    setRestoration('manual');
    window.addEventListener('scroll', record, { passive: true });
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('scroll', record);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', hidden);
      setRestoration('auto');
    };
  }, [memory]);

  useLayoutEffect(() => {
    const key = entryKey(location);
    const path = entryPath(location);
    const previous = current.current;
    if (previous?.key === key) return;
    // A restore still waiting for the previous page ends without recording it.
    restoring.current?.cancel();
    restoring.current = null;
    // A replaced entry is gone from the history.
    if (previous && type === 'REPLACE') memory.forget(previous.key);
    current.current = { key, path, location };
    const saved = memory.get(key, path);
    const action = scrollAction({
      type,
      previous: previous?.location ?? null,
      next: location,
      saved: saved !== null,
      documentRestored: restored
    });
    if (action === 'restore') {
      // Finishes at once when the page is already tall enough; otherwise the
      // attempt stays pending, and scroll events are not recorded meanwhile.
      const attempt = { cancel: () => {}, done: false };
      attempt.cancel = restoreScroll(saved, () => {
        attempt.done = true;
        if (restoring.current === attempt) restoring.current = null;
        memory.set(key, path, window.scrollY);
      });
      if (!attempt.done) restoring.current = attempt;
      return;
    }
    if (action === 'top') window.scrollTo(0, 0);
    memory.set(key, path, action === 'top' ? 0 : window.scrollY);
  }, [location, type, memory, restored]);

  return null;
}
