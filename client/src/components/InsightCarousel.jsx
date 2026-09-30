import { useState, useEffect, useCallback, useRef } from 'react';
import { useLang } from '../i18n.jsx';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js';
import { ArrowLeftIcon, ArrowRightIcon, PlayIcon, PauseIcon } from './Icons.jsx';
import { track } from '../utils/analytics.js';

const AUTO_MS = 6000;

// How many slides share one page, by viewport. Falls back to 1 where matchMedia
// is unavailable (SSR / tests), so the page count equals the slide count there.
function perViewFor() {
  if (typeof window === 'undefined' || !window.matchMedia) return 1;
  if (window.matchMedia('(min-width: 1024px)').matches) return 3;
  if (window.matchMedia('(min-width: 640px)').matches) return 2;
  return 1;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function pageStatus(t, current, total) {
  return t('carousel.page_status').replace('{current}', String(current)).replace('{total}', String(total));
}

// The default gallery keeps its overlay controls and existing autoplay.
// Homepage showcase mode adds visible playback controls and suspends rotation
// outside the visible document/viewport. Cards themselves have no rotation timer.
export default function InsightCarousel({ items, getId, renderSlide, ariaLabel, focusId = null, showcase = false }) {
  const { t } = useLang();
  const reduced = usePrefersReducedMotion();
  const regionRef = useRef(null);
  const layoutRef = useRef(null);
  const [perView, setPerView] = useState(perViewFor);
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [announcement, setAnnouncement] = useState(null);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [intersecting, setIntersecting] = useState(() => typeof IntersectionObserver === 'undefined');
  const visible = documentVisible && intersecting;
  const paused = hovered || focused || (showcase && (userPaused || !visible));

  const pages = chunk(items, perView);
  const pageCount = Math.max(1, pages.length);
  const currentPage = showcase ? Math.min(page, pageCount - 1) : page;
  const multi = pageCount > 1;
  const itemIdsKey = JSON.stringify(items.map(getId));
  const rotationPage = showcase ? currentPage : null;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setPerView(perViewFor());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Preserve the gallery's existing clamping behavior.
  useEffect(() => {
    if (!showcase) setPage(p => Math.min(p, pageCount - 1));
  }, [pageCount, showcase]);

  // Retain a visible dataset when responsive grouping or refreshed data changes.
  useEffect(() => {
    if (!showcase) return;
    const ids = JSON.parse(itemIdsKey);
    const previous = layoutRef.current;
    let next = Math.min(page, pageCount - 1);
    if (previous && (previous.perView !== perView || previous.idsKey !== itemIdsKey)) {
      setAnnouncement(null);
      const oldGroup = previous.ids.slice(previous.page * previous.perView, (previous.page + 1) * previous.perView);
      const anchor = oldGroup.find(id => ids.includes(id));
      const index = anchor === undefined ? -1 : ids.indexOf(anchor);
      if (index >= 0) next = Math.floor(index / perView);
    }
    layoutRef.current = { ids, idsKey: itemIdsKey, perView, page: next };
    if (next !== page) setPage(next);
  }, [showcase, itemIdsKey, perView, page, pageCount]);

  // Regrouping/removal can unmount a focused link without dispatching blur.
  // Retained controls still hold the focus pause; lost focus must not latch it.
  useEffect(() => {
    if (showcase && typeof document !== 'undefined') {
      setFocused(Boolean(regionRef.current?.contains(document.activeElement)));
    }
  }, [showcase, perView, itemIdsKey, multi, reduced]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const element = regionRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIntersecting(true);
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(candidate => candidate.target === element);
      if (entry) setIntersecting(entry.isIntersecting && entry.intersectionRatio >= 0.25);
    }, { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Jump to the page holding a deep-linked slide (e.g. /insights?focus=<dataset>).
  useEffect(() => {
    if (!focusId) return;
    const idx = items.findIndex(it => getId(it) === focusId);
    if (idx >= 0) setPage(Math.floor(idx / perView));
  }, [focusId, items, getId, perView]);

  // Showcase starts a fresh interval after navigation or any pause gate clears.
  // The ordinary gallery retains its interval across manual page changes.
  useEffect(() => {
    if (paused || reduced || !multi) return undefined;
    if (showcase) {
      const id = setTimeout(() => {
        setPage(p => (p + 1) % pageCount);
        setAnnouncement(null);
      }, AUTO_MS);
      return () => clearTimeout(id);
    }
    const id = setInterval(() => setPage(p => (p + 1) % pageCount), AUTO_MS);
    return () => clearInterval(id);
  }, [paused, reduced, multi, pageCount, showcase, rotationPage, navigationVersion]);

  const go = useCallback((p, source = 'control') => {
    const next = ((p % pageCount) + pageCount) % pageCount;
    track('carousel_navigate', { page: next + 1, pages: pageCount, source });
    setPage(next);
    if (showcase) {
      setNavigationVersion(version => version + 1);
      setAnnouncement({ current: next + 1, total: pageCount });
    }
  }, [pageCount, showcase]);

  const dotCount = showcase ? Math.min(5, pageCount) : pageCount;
  const dotStart = showcase ? Math.max(0, Math.min(currentPage - 2, pageCount - dotCount)) : 0;
  const dots = Array.from({ length: dotCount }, (_, i) => dotStart + i);
  const arrows = <>
    <button
      type="button"
      onClick={() => go(currentPage - 1, 'previous')}
      aria-label={t('carousel.prev')}
      className={showcase
        ? 'cq-glass h-11 w-11 shrink-0 rounded-full inline-flex items-center justify-center text-base-content hover:text-primary'
        : 'cq-glass absolute top-1/2 left-0 -translate-y-1/2 sm:-translate-x-1/2 z-10 w-9 h-9 rounded-full inline-flex items-center justify-center cursor-pointer text-base-content/70 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'}
    ><ArrowLeftIcon size={18} /></button>
    {showcase && <span className="text-sm text-base-content/70 tabular-nums" aria-live="off">{pageStatus(t, currentPage + 1, pageCount)}</span>}
    <button
      type="button"
      onClick={() => go(currentPage + 1, 'next')}
      aria-label={t('carousel.next')}
      className={showcase
        ? 'cq-glass h-11 w-11 shrink-0 rounded-full inline-flex items-center justify-center text-base-content hover:text-primary'
        : 'cq-glass absolute top-1/2 right-0 -translate-y-1/2 sm:translate-x-1/2 z-10 w-9 h-9 rounded-full inline-flex items-center justify-center cursor-pointer text-base-content/70 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'}
    ><ArrowRightIcon size={18} /></button>
  </>;

  return (
    <div
      ref={regionRef}
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="relative">
        <div className="overflow-hidden" aria-live={showcase ? 'off' : undefined}>
          <div
            className={'flex' + (reduced ? '' : ' transition-transform duration-500 ease-out')}
            style={{ transform: 'translateX(-' + currentPage * 100 + '%)' }}
          >
            {pages.map((group, gi) => (
              <div
                key={gi}
                className="shrink-0 w-full grid gap-5"
                inert={gi !== currentPage ? true : undefined}
                aria-hidden={gi !== currentPage ? true : undefined}
                style={{ gridTemplateColumns: 'repeat(' + perView + ', minmax(0, 1fr))' }}
              >
                {group.map((it, i) => (
                  <div key={getId(it) || i} className="min-w-0">
                    {renderSlide(it, gi * perView + i, { active: gi === currentPage, visible, reduced })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {multi && !showcase && arrows}
      </div>

      {multi && <>
        {showcase && <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-between">
          <div className="flex items-center gap-2">{arrows}</div>
          {!reduced && <button type="button" onClick={() => setUserPaused(value => !value)}
            className="cq-glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-base-content hover:text-primary">
            {userPaused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
            {t(userPaused ? 'carousel.resume' : 'carousel.pause')}
          </button>}
        </div>}
        <div className={'flex justify-center items-center ' + (showcase ? 'gap-1 mt-2' : 'gap-1.5 mt-5')}>
          {dots.map(i => (
            <button
              key={i}
              type="button"
              onClick={() => go(i, 'dot')}
              aria-label={t('carousel.goto') + ' ' + (i + 1)}
              aria-current={i === currentPage ? 'true' : undefined}
              className={showcase
                ? 'h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-full'
                : 'h-1.5 rounded-full transition-all ' + (i === currentPage ? 'w-5 bg-primary' : 'w-1.5 bg-base-content/25 hover:bg-base-content/40')}
            >
              {showcase && <span aria-hidden="true" className={'h-1.5 rounded-full' + (reduced ? '' : ' transition-all') + (i === currentPage ? ' w-5 bg-primary' : ' w-1.5 bg-base-content/25')} />}
            </button>
          ))}
        </div>
      </>}
      {showcase && <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement && pageStatus(t, announcement.current, announcement.total)}
      </span>}
    </div>
  );
}
