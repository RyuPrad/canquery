import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../i18n.jsx';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js';
import { ArrowLeftIcon, ArrowRightIcon } from './Icons.jsx';

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

// A Steam-style showcase carousel: a row of slides that auto-advances one page at
// a time, with prev/next arrows and pagination dots. Pauses on hover/focus, holds
// still for prefers-reduced-motion, and pages to a deep-linked slide (focusId).
// Data-driven (items + renderSlide) so it stays decoupled from the card it shows.
export default function InsightCarousel({ items, getId, renderSlide, ariaLabel, focusId = null }) {
  const { t } = useLang();
  const reduced = usePrefersReducedMotion();
  const [perView, setPerView] = useState(perViewFor);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);

  // Group slides into pages that are each exactly one container width, so paging
  // by translateX(-page * 100%) lands cleanly with no peek/clipping at the edges.
  const pages = chunk(items, perView);
  const pageCount = Math.max(1, pages.length);
  const multi = pageCount > 1;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setPerView(perViewFor());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep the page in range when perView or the item set changes.
  useEffect(() => { setPage((p) => Math.min(p, pageCount - 1)); }, [pageCount]);

  // Jump to the page holding a deep-linked slide (e.g. /insights?focus=<dataset>).
  useEffect(() => {
    if (!focusId) return;
    const idx = items.findIndex((it) => getId(it) === focusId);
    if (idx >= 0) setPage(Math.floor(idx / perView));
  }, [focusId, items, getId, perView]);

  // Auto-advance unless paused, reduced-motion, or there is only one page.
  useEffect(() => {
    if (paused || reduced || !multi) return undefined;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), AUTO_MS);
    return () => clearInterval(id);
  }, [paused, reduced, multi, pageCount]);

  const go = useCallback((p) => setPage(((p % pageCount) + pageCount) % pageCount), [pageCount]);

  return (
    <div
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="relative">
        <div className="overflow-hidden">
          <div
            className={'flex' + (reduced ? '' : ' transition-transform duration-500 ease-out')}
            style={{ transform: 'translateX(-' + page * 100 + '%)' }}
          >
            {pages.map((group, gi) => (
              <div
                key={gi}
                className="shrink-0 w-full grid gap-5"
                style={{ gridTemplateColumns: 'repeat(' + perView + ', minmax(0, 1fr))' }}
              >
                {group.map((it, i) => (
                  <div key={getId(it) || i} className="min-w-0">
                    {renderSlide(it, gi * perView + i)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {multi && (
          <>
            <button
              type="button"
              onClick={() => go(page - 1)}
              aria-label={t('carousel.prev')}
              className="cq-glass absolute top-1/2 left-0 -translate-y-1/2 sm:-translate-x-1/2 z-10 w-9 h-9 rounded-full inline-flex items-center justify-center cursor-pointer text-base-content/70 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ArrowLeftIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => go(page + 1)}
              aria-label={t('carousel.next')}
              className="cq-glass absolute top-1/2 right-0 -translate-y-1/2 sm:translate-x-1/2 z-10 w-9 h-9 rounded-full inline-flex items-center justify-center cursor-pointer text-base-content/70 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ArrowRightIcon size={18} />
            </button>
          </>
        )}
      </div>

      {multi && (
        <div className="flex justify-center items-center gap-1.5 mt-5">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={t('carousel.goto') + ' ' + (i + 1)}
              aria-current={i === page ? 'true' : undefined}
              className={'h-1.5 rounded-full transition-all ' + (i === page ? 'w-5 bg-primary' : 'w-1.5 bg-base-content/25 hover:bg-base-content/40')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
