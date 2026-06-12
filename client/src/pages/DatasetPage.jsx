import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchDataset, enqueueIngest } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import useJobPolling from '../hooks/useJobPolling.js';
import ResourceBadge from '../components/ResourceBadge.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

function PollBadge({ jobId, onDone, onRetry }) {
  const { job } = useJobPolling(jobId, { onDone });
  if (job && job.status === 'failed') {
    return (
      <span className='flex items-center gap-1'>
        <span className='badge badge-error badge-outline' title={job.error || 'The file could not be loaded'}>
          could not load this file
        </span>
        <button className='btn btn-xs btn-outline' onClick={onRetry}>Retry</button>
      </span>
    );
  }
  const label = !job || job.status === 'pending' ? 'queued...' : 'loading data...';
  return <span className='badge badge-warning gap-1'>{label}</span>;
}

export default function DatasetPage() {
  const { idOrName } = useParams();
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [lang, setLang] = useState('en');
  const [unlockJobs, setUnlockJobs] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);

  const pick = (obj) => obj ? (lang === 'fr' && obj.fr ? obj.fr : obj.en || obj.fr) : null;

  useEffect(() => {
    let cancelled = false;
    if (dataset === null) setLoading(true);
    fetchDataset(idOrName)
      .then(env => {
        if (!cancelled) {
          setDataset(env.data);
          setNotFound(false);
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

  if (notFound) {
    return (
      <div className='text-center py-20'>
        <h1>Dataset not found</h1>
        <Link to='/' className='link'>Back to search</Link>
      </div>
    );
  }

  if (loading && !dataset) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <div className='alert alert-error'>{error.message}</div>;
  }

  const handleUnlockDone = () => setRefreshKey(k => k + 1);

  return (
    <div className='space-y-3 py-6'>
      <div className='text-sm opacity-60'>
        <Link to='/' className='link'>back to search</Link>
      </div>

      <div className='flex justify-between items-start'>
        <h1 className='text-3xl font-bold'>{pick(dataset.title)}</h1>
        <div className='join'>
          <button
            className={'btn btn-xs join-item' + (lang === 'en' ? ' bg-[#d52b1e] text-white border-none' : '')}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <button
            className={'btn btn-xs join-item' + (lang === 'fr' ? ' bg-[#d52b1e] text-white border-none' : '')}
            onClick={() => setLang('fr')}
          >
            FR
          </button>
        </div>
      </div>

      {dataset.organization && (
        <div className='opacity-70'>{pick(dataset.organization.title)}</div>
      )}

      {dataset.metadata_modified && (
        <div className='text-sm opacity-50'>
          Updated {new Date(dataset.metadata_modified).toLocaleDateString()}
        </div>
      )}

      <p className='mt-4 max-w-3xl whitespace-pre-wrap opacity-90'>{pick(dataset.notes)}</p>

      <div className='flex flex-wrap gap-1 mt-3'>
        {(lang === 'fr' ? dataset.keywords?.fr : dataset.keywords?.en)?.map(kw => (
          <Link
            key={kw}
            to={'/?keyword=' + encodeURIComponent(kw)}
            className='badge badge-outline badge-sm hover:bg-base-300'
            title={'Find every dataset tagged ' + kw}
          >
            {kw}
          </Link>
        ))}
      </div>

      <h2 className='text-xl font-semibold mt-8 mb-3'>
        Resources ({dataset.resources.length})
      </h2>
      <div className='space-y-2'>
        {dataset.resources.map(resource => (
          <div key={resource.id} className='card bg-base-200 p-4 flex flex-row flex-wrap items-center gap-3'>
            <ResourceBadge mode={resource.query_mode} />
            <div className='flex-1 min-w-48'>
              <div className='font-medium'>{pick(resource.name) || resource.format || resource.id}</div>
              <div className='text-xs opacity-50'>
                {resource.format}
                {resource.size_bytes ? ' / ' + Math.round(resource.size_bytes / 1024) + ' KB' : ''}
              </div>
            </div>
            <div className='flex items-center gap-1'>
              {resource.query_mode === 'datastore' && (
                <Link to={'/resources/' + resource.id} className='btn btn-xs btn-outline'>
                  Explore data
                </Link>
              )}
              {resource.query_mode === 'ingested' && (
                <Link to={'/resources/' + resource.id} className='btn btn-xs btn-outline'>
                  Explore data
                </Link>
              )}
              {resource.query_mode === 'ingestable' && (
                unlockJobs[resource.id] ? (
                  <PollBadge
                    jobId={unlockJobs[resource.id]}
                    onDone={handleUnlockDone}
                    onRetry={() => setUnlockJobs(prev => {
                      const next = { ...prev };
                      delete next[resource.id];
                      return next;
                    })}
                  />
                ) : (
                  <button
                    className='btn btn-xs bg-[#d52b1e] text-white border-none'
                    onClick={async () => {
                      try {
                        const env = await enqueueIngest(resource.id);
                        setUnlockJobs(prev => ({ ...prev, [resource.id]: env.data.id }));
                      } catch (err) {
                        setError(err);
                      }
                    }}
                  >
                    Unlock
                  </button>
                )
              )}
              {(resource.query_mode === 'ingestable' || resource.query_mode === 'file-only') && (
                <a
                  href={resource.url}
                  target='_blank'
                  rel='noreferrer'
                  className='btn btn-xs btn-ghost'
                >
                  Download
                </a>
              )}
              {resource.query_mode === 'datastore' && (
                <a
                  href={resource.url}
                  target='_blank'
                  rel='noreferrer'
                  className='btn btn-xs btn-ghost'
                >
                  Download
                </a>
              )}
              {resource.query_mode === 'ingested' && (
                <a
                  href={resource.url}
                  target='_blank'
                  rel='noreferrer'
                  className='btn btn-xs btn-ghost'
                >
                  Download
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
