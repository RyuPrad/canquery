import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { fill } from '../utils/text.js';
import { fetchLmiaEmployer } from '../api/lmia.js';
import { LMIA_DATASET_ID, LMIA_GUIDE, formatCount, lmiaPeriodLabel, lmiaPeriodRange, provinceName, streamName } from '../utils/lmia.js';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import LmiaWatchSlot from '../components/LmiaWatchSlot.jsx';

// One employer's history on the positive LMIA employers lists, newest list first.
function EmployerHistory({ slug }) {
  const { t, lang } = useLang();
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchLmiaEmployer(slug, { signal: controller.signal })
      .then(envelope => setState({ status: 'ready', employer: envelope.data }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({ status: error && error.status === 404 ? 'missing' : 'error' });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  if (state.status === 'loading') return <LoadingSpinner label={t('lmia.employer_loading')} />;
  if (state.status === 'missing') {
    return (
      <div className="text-center py-28 px-4">
        <h1 className="text-2xl font-bold font-display">{t('lmia.employer_not_found')}</h1>
        <p className="text-base-content/65 mt-3">{t('lmia.employer_not_found_desc')}</p>
        <Link to="/lmia" className="btn btn-sm mt-6">{t('lmia.back')}</Link>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="alert alert-error flex flex-wrap justify-between gap-3">
          <span>{t('lmia.error')}</span>
          <button type="button" className="btn btn-sm" onClick={() => setAttempt(value => value + 1)}>{t('lmia.retry')}</button>
        </div>
      </div>
    );
  }

  const employer = state.employer;
  const periods = employer.periods;
  const last = lmiaPeriodLabel(periods[0], lang);
  const latestProvince = periods[0].provinces[0] || null;
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 cq-fade">
      <Breadcrumbs
        className="mb-5"
        label={t('breadcrumbs.label')}
        items={[
          { label: t('nav.datasets'), to: '/datasets' },
          { label: t('lmia.crumb_dataset'), to: '/datasets/' + LMIA_DATASET_ID },
          { label: t('lmia.crumb'), to: '/lmia' },
          { label: employer.name }
        ]}
      />
      <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-5">
          <div className="min-w-0">
            <span className="cq-chip">{t('lmia.employer_chip')}</span>
            <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3 break-words">{employer.name}</h1>
            <p className="text-base-content/70 mt-3 leading-relaxed">
              {periods.length === 1
                ? fill(t('lmia.employer_summary_one'), { period: last })
                : fill(t('lmia.employer_summary'), { lists: formatCount(periods.length, lang),
                  range: lmiaPeriodRange(periods[periods.length - 1], periods[0], lang) })}
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="cq-chip cq-chip-mono">{t('lmia.employer_positions')} · {formatCount(employer.positions, lang)}</span>
              {employer.lmias !== null && <span className="cq-chip cq-chip-mono">{t('lmia.employer_lmias')} · {formatCount(employer.lmias, lang)}</span>}
              <span className="cq-chip cq-chip-mono">{t('lmia.employer_lists')} · {formatCount(periods.length, lang)}</span>
            </div>
            <p className="text-sm text-base-content/65 mt-3">
              {fill(t('lmia.provinces_line'), { list: employer.provinces.map(code => provinceName(code, lang)).join(', ') })}
            </p>
            {employer.names.length > 1 && (
              <p className="text-sm text-base-content/65 mt-1">{fill(t('lmia.names_line'), { list: employer.names.slice(1, 6).join('; ') })}</p>
            )}
          </div>
          <LmiaWatchSlot employer={employer.name} employerKey={employer.key} province={latestProvince} placement="employer" />
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-display font-semibold text-xl">{t('lmia.history_heading')}</h2>
        {lang === 'fr' && <p className="text-xs text-base-content/55 mt-1">{t('lmia.titles_note')}</p>}
        <ol className="mt-3 space-y-3">
          {periods.map(period => (
            <li key={period.period_key} className="cq-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="font-semibold">{fill(t('lmia.list_label'), { period: lmiaPeriodLabel(period, lang) })}</h3>
                <Link to={'/resources/' + encodeURIComponent(period.resource_id)} className="link link-hover text-sm">{t('lmia.official_file')}</Link>
              </div>
              <p className="text-sm text-base-content/70 mt-1">
                {fill(t('lmia.positions_line'), { count: formatCount(period.positions, lang) })}
                {period.lmias !== null && <> · {fill(t('lmia.lmias_line'), { count: formatCount(period.lmias, lang) })}</>}
                {period.streams.length > 0 && <> · {period.streams.map(stream => streamName(stream, lang)).join(', ')}</>}
              </p>
              {period.occupations.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-xs uppercase tracking-wide text-base-content/50">{t('lmia.occupations')}</h4>
                  <ul className="mt-1 text-sm space-y-0.5">
                    {period.occupations.map(item => (
                      <li key={item.code} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 break-words">{item.code} – {item.title}</span>
                        <span className="font-mono text-xs text-base-content/65 shrink-0">{formatCount(item.positions, lang)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {period.addresses.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-xs uppercase tracking-wide text-base-content/50">{t('lmia.places')}</h4>
                  <ul className="mt-1 text-sm space-y-0.5">
                    {period.addresses.map(item => <li key={item.address} className="break-words">{item.address}</li>)}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ol>
        {employer.truncated && <p className="text-xs text-base-content/55 mt-3">{t('lmia.truncated')}</p>}
      </section>

      <div className="mt-8 rounded-xl border border-secondary/20 bg-secondary/5 px-4 py-3 text-sm text-base-content/70">
        <p>{t('lmia.caveat')}</p>
        <p className="mt-2">
          <Link to={LMIA_GUIDE[lang === 'fr' ? 'fr' : 'en']} className="link">{t('lmia.guide_link')}</Link>
          {' · '}
          <Link to="/lmia" className="link">{t('lmia.back')}</Link>
        </p>
      </div>
      <p className="text-xs text-base-content/55 mt-6">{t('lmia.source')}</p>
    </div>
  );
}

export default function LmiaEmployerPage() {
  const { slug } = useParams();
  return <EmployerHistory key={slug} slug={slug} />;
}
