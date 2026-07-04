import { useState, useEffect } from 'react';
import { fetchResourceProfile } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { classifyColumns } from './charts/classify.js';
import InsightsDashboard from './InsightsDashboard.jsx';
import ChartBuilder from './ChartBuilder.jsx';
import { SparklesIcon, ChartIcon } from './Icons.jsx';

export default function ChartPanel({ resourceId, q, filters, fields, queryMode, onLoad, loadState }) {
  const { t } = useLang();
  const [tab, setTab] = useState('insights');
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);

  const ingested = queryMode === 'ingested';

  // Profile the table once and share the resulting classification with both the
  // auto dashboard and the custom builder, so each picks good columns (never the
  // unique _id / row key) and we only hit the endpoint once.
  useEffect(() => {
    if (!ingested) return;
    let cancelled = false;
    setProfile(null);
    setProfileError(null);
    fetchResourceProfile(resourceId)
      .then((env) => { if (!cancelled) setProfile(env.data); })
      .catch((err) => { if (!cancelled) setProfileError(err); });
    return () => { cancelled = true; };
  }, [resourceId, ingested]);

  // Datastore resources can't be aggregated server-side - go straight to the
  // simple series builder.
  if (!ingested) {
    return <ChartBuilder resourceId={resourceId} q={q} filters={filters} fields={fields} queryMode={queryMode} onLoad={onLoad} loadState={loadState} />;
  }

  const classified = profile ? classifyColumns(profile) : null;

  return (
    <div className="space-y-3">
      <div className="cq-seg w-fit">
        <button
          className={'cq-seg-btn' + (tab === 'insights' ? ' cq-seg-active' : '')}
          onClick={() => setTab('insights')}
        >
          <SparklesIcon size={13} />
          {t('chart.insights')}
        </button>
        <button
          className={'cq-seg-btn' + (tab === 'custom' ? ' cq-seg-active' : '')}
          onClick={() => setTab('custom')}
        >
          <ChartIcon size={13} />
          {t('chart.custom')}
        </button>
      </div>

      {tab === 'insights' ? (
        <InsightsDashboard resourceId={resourceId} q={q} filters={filters} classified={classified} error={profileError} />
      ) : classified || profileError ? (
        <ChartBuilder resourceId={resourceId} q={q} filters={filters} fields={fields} queryMode={queryMode} classified={classified} />
      ) : (
        <div className="cq-skel h-[420px] rounded-xl" />
      )}
    </div>
  );
}
