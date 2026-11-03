import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { fill } from '../utils/text.js';
import { fetchLmiaSummary, searchLmiaEmployers } from '../api/lmia.js';
import { LMIA_DATASET_ID, LMIA_GUIDE, LMIA_PROVINCES, formatCount, lmiaPeriodLabel, lmiaPeriodRange, provinceName, streamName } from '../utils/lmia.js';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import SearchBar from '../components/SearchBar.jsx';
import LmiaWatchSlot from '../components/LmiaWatchSlot.jsx';

const OCCUPATION = /^\d{4,5}$/;

// "12 employers · 1 position", with the singular where the count is one.
function counts(t, lang, employers, positions) {
  const part = (count, key) => (count === 1 ? t(key + '_one') : fill(t(key), { count: formatCount(count, lang) }));
  return part(employers, 'lmia.count_employers') + ' · ' + part(positions, 'lmia.count_positions');
}

// A row of counts with a bar scaled to the largest value in its list.
function BarRow({ label, value, max, detail, lang }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words">{label}</span>
        <span className="font-mono text-xs text-base-content/65 shrink-0">{detail || formatCount(value, lang)}</span>
      </div>
      <div className="h-1.5 mt-1 rounded-full bg-base-content/10 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-primary/70" style={{ width: width + '%' }} />
      </div>
    </li>
  );
}

function SearchResults({ results, page, onPage, t, lang }) {
  if (!results) return null;
  if (results.status === 'loading' && !results.data) return <LoadingSpinner label={t('lmia.searching')} />;
  if (results.status === 'error') return <div className="alert alert-error mt-4">{results.message || t('lmia.search_error')}</div>;
  const data = results.data;
  if (!data) return null;
  const pages = Math.min(data.max_page, Math.max(1, Math.ceil(data.total / data.page_size)));
  return (
    <div className={'mt-4' + (results.status === 'loading' ? ' opacity-60' : '')} aria-busy={results.status === 'loading'}>
      <p className="text-sm text-base-content/65" role="status">
        {data.total === 1 ? t('lmia.results_one') : fill(t('lmia.results'), { count: formatCount(data.total, lang) })}
      </p>
      {data.total === 0 ? (
        <p className="mt-3 text-sm">{t('lmia.no_results')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.rows.map(row => (
            <li key={row.employer_key} className="cq-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <Link to={'/lmia/employers/' + row.slug} className="font-semibold link link-hover break-words">{row.employer}</Link>
                <p className="text-xs text-base-content/60 mt-1">
                  {[row.city, provinceName(row.province, lang)].filter(Boolean).join(', ')}
                  {' · '}
                  {row.periods === 1
                    ? fill(t('lmia.result_list_one'), { period: lmiaPeriodLabel(periodOf(row.last_period, data), lang) })
                    : fill(t('lmia.result_lists'), { count: formatCount(row.periods, lang), period: lmiaPeriodLabel(periodOf(row.last_period, data), lang) })}
                  {' · '}
                  {fill(t('lmia.result_positions'), { count: formatCount(row.positions, lang) })}
                </p>
              </div>
              <LmiaWatchSlot employer={row.employer} employerKey={row.employer_key} province={row.province} placement="search" />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3 mt-4" aria-label={t('lmia.pages')}>
          <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('lmia.previous')}</button>
          <span className="text-sm text-base-content/65">{fill(t('lmia.page'), { page, pages })}</span>
          <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('lmia.next')}</button>
        </nav>
      )}
    </div>
  );
}

// Search results carry period keys; the summary's periods (every loaded list) give
// them labels.
function periodOf(key, data) {
  return (data && data.periods && data.periods.find(period => period.period_key === key)) || null;
}

function Overview({ summary, t, lang }) {
  const latest = summary.latest;
  const label = lmiaPeriodLabel(latest, lang);
  const maxProvince = Math.max(...summary.provinces.map(row => row.positions), 0);
  const maxOccupation = Math.max(...summary.occupations.map(row => row.positions), 0);
  const maxPeriod = Math.max(...summary.periods.map(row => row.positions), 0);
  return (
    <>
      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl">{fill(t('lmia.latest_heading'), { period: label })}</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="cq-chip cq-chip-mono">{t('lmia.stat_employers')} · {formatCount(latest.employers, lang)}</span>
          <span className="cq-chip cq-chip-mono">{t('lmia.stat_positions')} · {formatCount(latest.positions, lang)}</span>
          {latest.lmias !== null && <span className="cq-chip cq-chip-mono">{t('lmia.stat_lmias')} · {formatCount(latest.lmias, lang)}</span>}
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="cq-card p-5">
            <h3 className="font-semibold">{t('lmia.by_province')}</h3>
            <ul className="mt-2">
              {summary.provinces.map(row => (
                <BarRow key={row.province} label={provinceName(row.province, lang)} value={row.positions} max={maxProvince} lang={lang}
                  detail={counts(t, lang, row.employers, row.positions)} />
              ))}
            </ul>
          </div>
          <div className="cq-card p-5">
            <h3 className="font-semibold">{t('lmia.top_occupations')}</h3>
            <ul className="mt-2">
              {summary.occupations.map(row => (
                <BarRow key={row.code} label={row.code + ' – ' + row.title} value={row.positions} max={maxOccupation} lang={lang} />
              ))}
            </ul>
            <p className="text-xs text-base-content/55 mt-3">{t('lmia.occupation_hint')}</p>
            {lang === 'fr' && <p className="text-xs text-base-content/55 mt-1">{t('lmia.titles_note')}</p>}
          </div>
          <div className="cq-card p-5">
            <h3 className="font-semibold">{t('lmia.by_stream')}</h3>
            <ul className="mt-2">
              {summary.streams.map(row => (
                <BarRow key={row.stream} label={streamName(row.stream, lang)} value={row.positions} max={summary.streams[0].positions} lang={lang}
                  detail={counts(t, lang, row.employers, row.positions)} />
              ))}
            </ul>
          </div>
          <div className="cq-card p-5">
            <h3 className="font-semibold">{t('lmia.top_employers')}</h3>
            <ol className="mt-2 space-y-1.5 text-sm">
              {summary.top_employers.map(row => (
                <li key={row.employer_key} className="flex items-baseline justify-between gap-3">
                  <Link to={'/lmia/employers/' + row.slug} className="link link-hover min-w-0 break-words">{row.employer}</Link>
                  <span className="font-mono text-xs text-base-content/65 shrink-0">{formatCount(row.positions, lang)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl">{t('lmia.lists_heading')}</h2>
        <p className="text-sm text-base-content/65 mt-1">{t('lmia.lists_intro')}</p>
        <ul className="cq-card p-5 mt-3">
          {[...summary.periods].reverse().map(period => (
            <BarRow key={period.resource_id} value={period.positions} max={maxPeriod} lang={lang}
              label={<Link to={'/resources/' + encodeURIComponent(period.resource_id)} className="link link-hover">
                {fill(t('lmia.list_label'), { period: lmiaPeriodLabel(period, lang) })}</Link>}
              detail={counts(t, lang, period.employers, period.positions)} />
          ))}
        </ul>
      </section>
    </>
  );
}

export default function LmiaPage() {
  const { t, lang } = useLang();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const province = params.get('province') || '';
  const occupation = params.get('occupation') || '';
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const [draft, setDraft] = useState(q);
  const [occupationDraft, setOccupationDraft] = useState(occupation);
  const [summary, setSummary] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState(null);

  const update = (changes, { keepPage = false } = {}) => setParams(prev => {
    const next = new URLSearchParams(prev);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    if (!keepPage) next.delete('page');
    return next;
  }, { replace: true });

  useEffect(() => {
    const controller = new AbortController();
    setSummary({ status: 'loading' });
    fetchLmiaSummary({ signal: controller.signal })
      .then(envelope => setSummary({ status: 'ready', data: envelope.data }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setSummary({ status: error && error.status === 503 ? 'unavailable' : 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  // The typed name and code reach the address (and the search) after a pause.
  useEffect(() => {
    if (draft === q) return undefined;
    const timer = setTimeout(() => update({ q: draft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const value = occupationDraft.trim();
    if (value === occupation || (value && !OCCUPATION.test(value))) return undefined;
    const timer = setTimeout(() => update({ occupation: value }), 300);
    return () => clearTimeout(timer);
  }, [occupationDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = Boolean(q || province || occupation);
  const ready = summary.status === 'ready';
  useEffect(() => {
    if (!searching || !ready) {
      setResults(null);
      return undefined;
    }
    const controller = new AbortController();
    setResults(previous => ({ status: 'loading', data: previous && previous.data }));
    searchLmiaEmployers({ q, province, occupation, page }, { signal: controller.signal })
      .then(envelope => setResults({ status: 'ready', data: { ...envelope.data, periods: summary.data.periods } }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setResults({ status: 'error', message: error && error.status === 429 ? t('lmia.rate_limited') : null });
      });
    return () => controller.abort();
  }, [q, province, occupation, page, searching, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = [
    { label: t('nav.datasets'), to: '/datasets' },
    { label: t('lmia.crumb_dataset'), to: '/datasets/' + LMIA_DATASET_ID },
    { label: t('lmia.crumb') }
  ];
  if (summary.status === 'loading') return <LoadingSpinner label={t('lmia.loading')} />;
  if (summary.status === 'error') {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="alert alert-error flex flex-wrap justify-between gap-3">
          <span>{t('lmia.error')}</span>
          <button type="button" className="btn btn-sm" onClick={() => setAttempt(value => value + 1)}>{t('lmia.retry')}</button>
        </div>
      </div>
    );
  }
  const data = summary.data;
  const occupationInvalid = occupationDraft.trim() !== '' && !OCCUPATION.test(occupationDraft.trim());
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <Breadcrumbs className="mb-5" label={t('breadcrumbs.label')} items={crumbs} />
      <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
        <div className="relative">
          <span className="cq-chip">{t('lmia.chip')}</span>
          <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3">{t('lmia.title')}</h1>
          {ready ? (
            <p className="text-base-content/70 mt-3 leading-relaxed max-w-3xl">
              {fill(t('lmia.intro'), { range: lmiaPeriodRange(data.periods[0], data.latest, lang) })}
            </p>
          ) : (
            <p className="text-base-content/70 mt-3 leading-relaxed max-w-3xl">{t('lmia.unavailable')}</p>
          )}
          <p className="text-sm text-base-content/60 mt-3 leading-relaxed max-w-3xl">{t('lmia.caveat')}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {ready && (
              <>
                <span className="cq-chip cq-chip-mono">{t('lmia.stat_latest')} · {lmiaPeriodLabel(data.latest, lang)}</span>
                <span className="cq-chip cq-chip-mono">{t('lmia.stat_all')} · {formatCount(data.employers_total, lang)}</span>
              </>
            )}
            <Link to={LMIA_GUIDE[lang === 'fr' ? 'fr' : 'en']} className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('lmia.guide_link')}</Link>
            <Link to={'/datasets/' + LMIA_DATASET_ID} className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('lmia.dataset_link')}</Link>
          </div>
        </div>
      </div>

      {ready && (
        <section className="mt-8" aria-labelledby="lmia-search">
          <h2 id="lmia-search" className="font-display font-semibold text-xl">{t('lmia.search_title')}</h2>
          <div className="grid gap-3 mt-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_minmax(0,14rem)]">
            <SearchBar value={draft} onChange={setDraft} placeholder={t('lmia.search_placeholder')} />
            <select className="select select-bordered w-full" aria-label={t('lmia.province_label')} value={province}
              onChange={event => update({ province: event.target.value })}>
              <option value="">{t('lmia.province_any')}</option>
              {LMIA_PROVINCES.map(([code]) => <option key={code} value={code}>{provinceName(code, lang)}</option>)}
            </select>
            <div>
              <input className={'input input-bordered w-full' + (occupationInvalid ? ' input-error' : '')} inputMode="numeric"
                aria-label={t('lmia.occupation_label')} placeholder={t('lmia.occupation_placeholder')} value={occupationDraft}
                aria-invalid={occupationInvalid} aria-describedby={occupationInvalid ? 'lmia-occupation-error' : undefined}
                onChange={event => setOccupationDraft(event.target.value)} maxLength={5} />
              {occupationInvalid && <p id="lmia-occupation-error" className="text-xs text-error mt-1">{t('lmia.occupation_invalid')}</p>}
            </div>
          </div>
          {searching && <SearchResults results={results} page={page} t={t} lang={lang}
            onPage={value => update({ page: value > 1 ? value : '' }, { keepPage: true })} />}
        </section>
      )}

      {ready && <Overview summary={data} t={t} lang={lang} />}

      <p className="text-xs text-base-content/55 mt-10">{t('lmia.source')}</p>
    </div>
  );
}
