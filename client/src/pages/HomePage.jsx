import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { searchDatasets, fetchOrganizations, fetchStats, fetchFeatured } from '../api/catalog.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import useCountUp from '../hooks/useCountUp.js';
import { useLang } from '../i18n.jsx';
import SearchBar from '../components/SearchBar.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import RecentRail from '../components/RecentRail.jsx';
import PopularRail from '../components/PopularRail.jsx';
import HeroChartWidget from '../components/HeroChartWidget.jsx';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js';
import { formatRelativeTime } from '../utils/time.js';
import {
  MapleLeaf,
  SearchIcon,
  UnlockIcon,
  ChartIcon,
  DatabaseIcon,
  ZapIcon,
  XIcon,
} from '../components/Icons.jsx';

const FORMATS = ['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML'];
const EXAMPLES = ['housing', 'wildfire', 'electric vehicles', 'water quality', 'census'];

function StatCard({ icon, value, label, tone, delay }) {
  const n = useCountUp(value);
  return (
    <div className={`cq-card p-4 sm:p-5 flex items-center gap-3.5 text-left cq-fade ${delay}`}>
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-display font-bold text-2xl sm:text-[1.7rem] leading-none tabular-nums">
          {n.toLocaleString()}
        </div>
        <div className="text-[0.72rem] text-base-content/45 mt-1.5 truncate">{label}</div>
      </div>
    </div>
  );
}

function StepCard({ icon, number, title, desc, tone, delay }) {
  return (
    <div className={`cq-card p-5 relative overflow-hidden cq-fade ${delay}`}>
      <span
        className="absolute -top-4 right-1 font-display font-bold text-[4.5rem] leading-none text-base-content/5 select-none"
        aria-hidden="true"
      >
        {number}
      </span>
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${tone}`}>
        {icon}
      </span>
      <div className="font-semibold text-[0.95rem]">{title}</div>
      <p className="text-sm text-base-content/55 mt-1 leading-relaxed">{desc}</p>
    </div>
  );
}

export default function HomePage() {
  const { t, lang } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [org, setOrg] = useState(searchParams.get('org') || '');
  const [format, setFormat] = useState(searchParams.get('format') || '');
  const keyword = searchParams.get('keyword') || '';
  const [stats, setStats] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [featured, setFeatured] = useState([]);
  const reduced = usePrefersReducedMotion();

  const debouncedQuery = useDebouncedValue(query, 250);

  // Keep the URL shareable: reflect the active search in the query string.
  useEffect(() => {
    const next = {};
    if (debouncedQuery) next.q = debouncedQuery;
    if (org) next.org = org;
    if (format) next.format = format;
    if (keyword) next.keyword = keyword;
    setSearchParams(next, { replace: true });
  }, [debouncedQuery, org, format, keyword, setSearchParams]);

  const clearKeyword = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('keyword');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    fetchStats().then((env) => {
      if (!cancelled && env) setStats(env.data);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOrganizations({ limit: 50 })
      .then((env) => {
        if (!cancelled) setOrgs(env.data || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchFeatured(lang).then((env) => {
      if (!cancelled && env) setFeatured(env.data || []);
    });
    return () => { cancelled = true; };
  }, [lang]);

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePaginatedCollection(
    (cursor) =>
      searchDatasets({
        q: debouncedQuery || undefined,
        org: org || undefined,
        format: format || undefined,
        keyword: keyword || undefined,
        limit: 20,
        cursor,
      }),
    [debouncedQuery, org, format, keyword]
  );

  const filtering = Boolean(debouncedQuery || org || format || keyword);
  const synced = stats?.last_synced_at ? formatRelativeTime(stats.last_synced_at, lang) : null;

  return (
    <div className="relative">
      <div
        className="absolute inset-x-0 top-0 h-[440px] cq-grid-bg pointer-events-none"
        aria-hidden="true"
      />
      {!filtering && featured.length > 0 && (
        <>
          <HeroChartWidget
            items={featured}
            startIndex={0}
            reduced={reduced}
            className="hidden xl:block absolute left-3 2xl:left-10 top-[150px] z-10 cq-fade cq-fade-3"
          />
          <HeroChartWidget
            items={featured}
            startIndex={Math.floor(featured.length / 2)}
            reduced={reduced}
            className="hidden xl:block absolute right-3 2xl:right-10 top-[150px] z-10 cq-fade cq-fade-4"
          />
        </>
      )}
      <div className="relative max-w-6xl mx-auto px-4 pb-4">
        <section className="pt-14 pb-2 text-center cq-fade">
          <div className="cq-chip cq-chip-mono mb-5 !px-3 !py-1.5">
            <MapleLeaf size={11} className="text-primary" />
            {t('home.hero_chip')}
            {synced && (
              <span className="text-base-content/40 hidden sm:inline">
                · {t('home.synced')} {synced}
              </span>
            )}
          </div>
          <h1 className="font-display font-bold tracking-tight text-4xl sm:text-5xl md:text-[3.6rem] leading-[1.05] cq-title-grad pb-1">
            {t('home.title')}
          </h1>
          <p className="text-base sm:text-lg text-base-content/55 max-w-2xl mx-auto mt-4 leading-relaxed">
            {t('home.subtitle')}
          </p>

          <div className="max-w-2xl mx-auto mt-8">
            <SearchBar value={query} onChange={setQuery} />
          </div>

          <div className="flex flex-wrap gap-2 items-center justify-center mt-4">
            <span className="text-xs text-base-content/35">{t('home.try')}</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="cq-pill !text-xs" onClick={() => setQuery(ex)}>
                {ex}
              </button>
            ))}
            {keyword && (
              <button
                className="cq-pill cq-pill-active !text-xs inline-flex items-center gap-1.5"
                onClick={clearKeyword}
                title={t('home.keyword_clear')}
              >
                {t('home.keyword_label')} {keyword}
                <XIcon size={11} />
              </button>
            )}
          </div>
        </section>

        {!filtering && featured.length > 0 && (
          <div className="xl:hidden mt-6 max-w-xl mx-auto">
            <HeroChartWidget items={featured} reduced={reduced} horizontal />
          </div>
        )}

        {!filtering && stats && (
          <section className="grid sm:grid-cols-3 gap-3.5 mt-10 max-w-4xl mx-auto">
            <StatCard
              icon={<DatabaseIcon size={18} />}
              tone="bg-accent/10 text-accent"
              value={stats.datasets}
              label={t('home.datasets_mirrored')}
              delay="cq-fade-1"
            />
            <StatCard
              icon={<ZapIcon size={18} />}
              tone="bg-success/10 text-success"
              value={stats.datastore_active_resources}
              label={t('home.queryable_upstream')}
              delay="cq-fade-2"
            />
            <StatCard
              icon={<UnlockIcon size={18} />}
              tone="bg-primary/15 cq-fg-red"
              value={stats.ingested_resources}
              label={t('home.unlocked_here')}
              delay="cq-fade-3"
            />
          </section>
        )}

        {!filtering && (
          <section className="grid sm:grid-cols-3 gap-3.5 mt-4">
            <StepCard
              number="1"
              icon={<SearchIcon size={18} />}
              tone="bg-accent/10 text-accent"
              title={t('home.step1_title')}
              desc={t('home.step1_desc')}
              delay="cq-fade-2"
            />
            <StepCard
              number="2"
              icon={<UnlockIcon size={18} />}
              tone="bg-primary/15 cq-fg-red"
              title={t('home.step2_title')}
              desc={t('home.step2_desc')}
              delay="cq-fade-3"
            />
            <StepCard
              number="3"
              icon={<ChartIcon size={18} />}
              tone="bg-secondary/10 text-secondary"
              title={t('home.step3_title')}
              desc={t('home.step3_desc')}
              delay="cq-fade-4"
            />
          </section>
        )}

        <div className="flex flex-wrap gap-2 items-center mt-10">
          <button
            className={'cq-pill' + (format === '' ? ' cq-pill-active' : '')}
            onClick={() => setFormat('')}
          >
            {t('home.all_formats')}
          </button>
          {FORMATS.map((f) => (
            <button
              key={f}
              className={'cq-pill' + (format === f ? ' cq-pill-active' : '')}
              onClick={() => setFormat(f)}
            >
              {f}
            </button>
          ))}
          <select
            className="select select-sm sm:ml-auto w-full sm:w-64 bg-base-200 border-base-content/10 rounded-lg text-[0.82rem]"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          >
            <option value="">{t('home.all_organizations')}</option>
            {orgs.map((o) => (
              <option key={o.name} value={o.name}>
                {o.title?.en || o.name} ({o.dataset_count})
              </option>
            ))}
          </select>
        </div>

        {!filtering && (
          <>
            <PopularRail />
            <RecentRail />
          </>
        )}

        <section className="mt-6 space-y-3">
          {loading && (
            <div className="space-y-3" aria-label={t('home.searching')}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="cq-skel h-[74px]" />
              ))}
            </div>
          )}
          {error && <div className="alert alert-error">{error.message}</div>}
          {items.length === 0 && !loading && !error && (
            <div className="text-center py-16 space-y-2 cq-fade">
              <MapleLeaf size={34} className="mx-auto text-base-content/15" />
              <p className="text-base-content/60">{t('home.no_results')}</p>
              <p className="text-sm text-base-content/35">{t('home.no_results_hint')}</p>
            </div>
          )}
          {items.map((d) => (
            <DatasetRow key={d.id} dataset={d} />
          ))}
        </section>

        {hasMore && (
          <div className="text-center mt-6">
            <button
              className="btn btn-outline btn-sm rounded-full px-7 border-base-content/20"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? t('home.loading') : t('home.load_more')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
