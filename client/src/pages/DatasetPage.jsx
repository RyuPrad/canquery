import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { fetchDataset, enqueueIngest } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import useJobPolling from '../hooks/useJobPolling.js';
import { readUnlockJob, writeUnlockJob, clearUnlockJob } from '../utils/unlockStore.js';
import ResourceBadge from '../components/ResourceBadge.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useLang } from '../i18n.jsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BuildingIcon,
  CalendarIcon,
  DownloadIcon,
  UnlockIcon,
} from '../components/Icons.jsx';

const FMT_STYLES = {
  CSV: { color: '#5eead4', background: 'rgba(45,212,191,0.12)' },
  XLSX: { color: '#86efac', background: 'rgba(74,222,128,0.12)' },
  XLS: { color: '#86efac', background: 'rgba(74,222,128,0.12)' },
  JSON: { color: '#fcd34d', background: 'rgba(251,191,36,0.12)' },
  GEOJSON: { color: '#93c5fd', background: 'rgba(106,166,255,0.14)' },
  PDF: { color: '#ff958c', background: 'rgba(213,43,30,0.14)' },
  XML: { color: '#c4b5fd', background: 'rgba(167,139,250,0.13)' },
};
const FMT_FALLBACK = { color: '#9aa7bd', background: 'rgba(154,167,189,0.12)' };

function FormatTile({ format }) {
  const style = FMT_STYLES[format] || FMT_FALLBACK;
  const label = (format || 'FILE').slice(0, 7);
  return (
    <span className="cq-fmt" style={style}>
      {label}
    </span>
  );
}

function PollBadge({ jobId, onDone, onRetry }) {
  const { t } = useLang();
  const { job } = useJobPolling(jobId, { onDone });
  if (job && job.status === 'failed') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="cq-badge cq-badge-fileonly" title={job.error || t('dataset.load_failed')}>
          {t('dataset.load_failed')}
        </span>
        <button className="btn btn-xs btn-outline rounded-lg border-base-content/20" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </span>
    );
  }
  const label = !job || job.status === 'pending' ? t('dataset.queued') : t('dataset.loading_data');
  return (
    <span className="cq-badge cq-badge-ingestable">
      <span className="loading loading-spinner loading-xs"></span>
      {label}
    </span>
  );
}

export default function DatasetPage() {
  const { idOrName } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang: uiLang, t } = useLang();
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [contentLang, setContentLang] = useState(uiLang);
  const [unlockJobs, setUnlockJobs] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [highlightId, setHighlightId] = useState(null);

  const pick = (obj) => obj ? (contentLang === 'fr' && obj.fr ? obj.fr : obj.en || obj.fr) : null;

  useEffect(() => {
    let cancelled = false;
    if (dataset === null) setLoading(true);
    fetchDataset(idOrName)
      .then(env => {
        if (!cancelled) {
          setDataset(env.data);
          setNotFound(false);
          // Resume any unlocks left in flight before a refresh so their
          // loading badges reappear instead of reverting to "Unlock".
          const resumed = {};
          for (const r of (env.data.resources || [])) {
            const stored = readUnlockJob(r.id);
            if (stored) resumed[r.id] = stored;
          }
          if (Object.keys(resumed).length) {
            setUnlockJobs(prev => ({ ...resumed, ...prev }));
          }
        }
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof NotFoundError) setNotFound(true);
        else setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // dataset is intentionally omitted: it only gates the first-load spinner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrName, refreshKey]);

  // Deep-link from an insight card (/datasets/:id?highlight=:resourceId): scroll
  // the representative resource into view and pulse it so the visitor sees which
  // one to open, then drop the param so a refresh doesn't re-trigger it.
  useEffect(() => {
    const focusId = searchParams.get('highlight');
    if (!focusId || !dataset) return undefined;
    const el = document.getElementById('res-' + focusId);
    if (el) {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setHighlightId(focusId);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
    const timer = setTimeout(() => setHighlightId(null), 3400);
    return () => clearTimeout(timer);
  }, [dataset, searchParams, setSearchParams]);

  if (notFound) {
    return (
      <div className="text-center py-28 space-y-3 cq-fade">
        <h1 className="text-2xl font-bold font-display">{t('common.dataset_not_found')}</h1>
        <Link to="/" className="link link-hover text-base-content/60">{t('common.back_search')}</Link>
      </div>
    );
  }

  if (loading && !dataset) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="alert alert-error">{error.message}</div>
      </div>
    );
  }

  const handleUnlockDone = () => setRefreshKey(k => k + 1);
  const queryable = (mode) => mode === 'datastore' || mode === 'ingested';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4 cq-fade">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-base-content/50 hover:text-base-content transition-colors"
      >
        <ArrowLeftIcon size={14} />
        {t('common.back_search')}
      </Link>

      <div className="flex justify-between items-start gap-4">
        <h1 className="text-3xl sm:text-4xl font-bold font-display tracking-tight leading-tight">
          {pick(dataset.title)}
        </h1>
        <div className="cq-seg shrink-0 mt-1.5">
          <button
            className={'cq-seg-btn' + (contentLang === 'en' ? ' cq-seg-active' : '')}
            onClick={() => setContentLang('en')}
          >
            EN
          </button>
          <button
            className={'cq-seg-btn' + (contentLang === 'fr' ? ' cq-seg-active' : '')}
            onClick={() => setContentLang('fr')}
          >
            FR
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-base-content/55">
        {dataset.organization && (
          <span className="inline-flex items-center gap-1.5">
            <BuildingIcon size={14} />
            {pick(dataset.organization.title)}
          </span>
        )}
        {dataset.metadata_modified && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon size={14} />
            {t('common.updated')} {new Date(dataset.metadata_modified).toLocaleDateString()}
          </span>
        )}
      </div>

      <p className="max-w-3xl whitespace-pre-wrap text-[0.95rem] leading-relaxed text-base-content/75">
        {pick(dataset.notes)}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(contentLang === 'fr' ? dataset.keywords?.fr : dataset.keywords?.en)?.map(kw => (
          <Link
            key={kw}
            to={'/?keyword=' + encodeURIComponent(kw)}
            className="cq-pill !text-xs !font-medium"
            title={'Find every dataset tagged ' + kw}
          >
            {kw}
          </Link>
        ))}
      </div>

      <h2 className="text-lg font-semibold font-display pt-6 flex items-center gap-2.5">
        {t('dataset.resources')}
        <span className="cq-chip cq-chip-mono">{dataset.resources.length}</span>
      </h2>
      <div className="space-y-2.5">
        {dataset.resources.map(resource => (
          <div
            key={resource.id}
            id={'res-' + resource.id}
            className={'cq-card cq-card-hover p-3.5 sm:p-4 flex flex-row flex-wrap items-center gap-3.5' + (highlightId === resource.id ? ' cq-focus-ring' : '')}
          >
            <FormatTile format={resource.format} />
            <div className="flex-1 min-w-48">
              <div className="font-medium text-[0.92rem] leading-snug">
                {pick(resource.name) || resource.format || resource.id}
              </div>
              <div className="text-xs text-base-content/40 mt-0.5 font-mono">
                {resource.format}
                {resource.size_bytes ? ' · ' + Math.round(resource.size_bytes / 1024) + ' KB' : ''}
              </div>
            </div>
            <ResourceBadge mode={resource.query_mode} />
            <div className="flex items-center gap-1.5">
              {queryable(resource.query_mode) && (
                <Link
                  to={'/resources/' + resource.id}
                  className="btn btn-xs btn-primary rounded-lg gap-1"
                >
                  {t('common.explore')}
                  <ArrowRightIcon size={11} />
                </Link>
              )}
              {resource.query_mode === 'ingestable' && (
                unlockJobs[resource.id] ? (
                  <PollBadge
                    jobId={unlockJobs[resource.id]}
                    onDone={() => { clearUnlockJob(resource.id); handleUnlockDone(); }}
                    onRetry={() => {
                      clearUnlockJob(resource.id);
                      setUnlockJobs(prev => {
                        const next = { ...prev };
                        delete next[resource.id];
                        return next;
                      });
                    }}
                  />
                ) : (
                  <button
                    className="btn btn-xs btn-primary rounded-lg gap-1"
                    onClick={async () => {
                      try {
                        const env = await enqueueIngest(resource.id);
                        setUnlockJobs(prev => ({ ...prev, [resource.id]: env.data.id }));
                        writeUnlockJob(resource.id, env.data.id);
                      } catch (err) {
                        setError(err);
                      }
                    }}
                  >
                    <UnlockIcon size={11} />
                    {t('dataset.unlock')}
                  </button>
                )
              )}
              <a
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-xs btn-ghost rounded-lg gap-1 text-base-content/60"
              >
                <DownloadIcon size={11} />
                {t('dataset.download')}
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
