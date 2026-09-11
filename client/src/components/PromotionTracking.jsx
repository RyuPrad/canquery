/* eslint-disable react-refresh/only-export-components -- provider and its hook share the navigation lifetime */
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { analyticsOptedOut, track } from '../utils/analytics.js';
import { promotionProperties } from '../utils/promotion.js';

const PromotionVisit = createContext(null);

export function PromotionTracking({ children }) {
  const { pathname, search } = useLocation();
  // A fresh URL is a fresh visit. Theme, language, hash and same-URL replace
  // operations preserve it, including placements temporarily unmounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- URL changes intentionally reset the per-visit set.
  const seen = useMemo(() => new Set(), [pathname, search]);
  return <PromotionVisit.Provider value={seen}>{children}</PromotionVisit.Provider>;
}

export function usePromotionView(placement) {
  const ref = useRef(null);
  const seen = useContext(PromotionVisit);
  useEffect(() => {
    const element = ref.current;
    if (!seen || seen.has(placement) || !element || !globalThis.IntersectionObserver || analyticsOptedOut()) return;
    let visible = false;
    let timer;
    const clear = () => { clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      clear();
      if (!visible || document.hidden || seen.has(placement) || analyticsOptedOut() || typeof window.umami?.track !== 'function') return;
      timer = setTimeout(() => {
        if (visible && !document.hidden && !seen.has(placement) && track('promotion_view', promotionProperties(element))) {
          seen.add(placement);
          cleanup();
        }
      }, 1000);
    };
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === element);
      if (!entry) return;
      const next = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      if (next !== visible) { visible = next; schedule(); }
    }, { threshold: [0, 0.5] });
    const cleanup = () => {
      clear();
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('canquery:analytics-ready', schedule);
    };
    observer.observe(element);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('canquery:analytics-ready', schedule);
    return cleanup;
  }, [placement, seen]);
  return ref;
}
