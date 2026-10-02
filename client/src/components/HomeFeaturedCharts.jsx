import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchFeatured } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { selectFeaturedCharts } from '../utils/featuredCharts.js';
import HeroChartWidget from './HeroChartWidget.jsx';

export default function HomeFeaturedCharts({ enabled }) {
  const { lang, t } = useLang();
  const region = useRef(null);
  const [activated, setActivated] = useState(false);
  const [result, setResult] = useState({ lang: null, items: [] });

  useEffect(() => {
    if (!enabled || activated) return;
    if (typeof IntersectionObserver === 'undefined') {
      setActivated(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setActivated(true);
        observer.disconnect();
      }
    }, { rootMargin: '800px 0px' });
    observer.observe(region.current);
    return () => observer.disconnect();
  }, [enabled, activated]);

  useEffect(() => {
    if (!enabled || !activated) return;
    let cancelled = false;
    const controller = new AbortController();
    const settle = (items, failed = false) => {
      if (cancelled) return;
      // Removing a slot the reader has reached would move the visible content.
      // Empty results that are still below the viewport can disappear safely.
      const keepEmpty = region.current?.getBoundingClientRect().top < window.innerHeight;
      setResult({ lang, items, failed, keepEmpty });
    };
    fetchFeatured(lang, { signal: controller.signal })
      .then(env => settle(selectFeaturedCharts(env?.data)))
      .catch(() => settle([], true));
    return () => { cancelled = true; controller.abort(); };
  }, [enabled, activated, lang]);

  const empty = result.lang === lang && result.items.length === 0;
  if (!enabled || (empty && !result.keepEmpty)) return null;
  const pending = result.items.length === 0 && !empty;
  return <section ref={region} className="cq-home-section cq-home-featured-slot"
    aria-label={pending ? t('home.loading') : undefined}
    aria-labelledby={pending ? undefined : 'home-insight-title'} aria-busy={pending}>
    {pending ? <div aria-hidden="true">
      <div className="cq-skel h-8 w-2/3 mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="cq-skel h-[34rem]" />
        <div className="cq-skel h-[34rem] hidden sm:block" />
        <div className="cq-skel h-[34rem] hidden lg:block" />
      </div>
    </div> : <>
      <h2 id="home-insight-title" className="font-display font-semibold text-2xl sm:text-3xl mb-5">{t('home.insight_title')}</h2>
      {/* Keep this instance mounted after activation so scroll/visibility and
          language refreshes preserve its manual pause and focused card. */}
      {empty ? <div className="cq-card min-h-[34rem] p-6 flex flex-col items-center justify-center text-center gap-4">
        <p>{t(result.failed ? 'home.featured_unavailable' : 'home.featured_empty')}</p>
        <Link to="/insights" className="cq-link">{t('home.featured_cta')}</Link>
      </div> : <HeroChartWidget items={result.items} />}
    </>}
  </section>;
}
