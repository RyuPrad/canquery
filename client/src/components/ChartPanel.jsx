import { useState, useEffect, useRef, useCallback } from 'react';
import { NotIngestedError } from '../api/client.js';
import { fetchResourceCharts } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import InsightsDashboard from './InsightsDashboard.jsx';
import ChartBuilder from './ChartBuilder.jsx';
import { SparklesIcon, ChartIcon } from './Icons.jsx';
import { track } from '../utils/analytics.js';
import { useChartLoadReport } from '../hooks/useChartLoadReport.js';

// The Chart tab. One request to the chart engine per table, search, filters
// and language answers both views: the automatic charts, and the table's
// model, which the custom builder offers its choices from.
export default function ChartPanel({ resourceId, q, filters, fields, queryMode, onUnavailable, onPin }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState('insights');
  const [result, setResult] = useState({ data: null, error: null, loading: false });
  const [attempt, setAttempt] = useState(0);
  // The first answer of a visit counts the visit; later ones (searches,
  // filters, a language switch) are read in the background.
  const looked = useRef(false);

  const ingested = queryMode === 'ingested';
  const filtersKey = JSON.stringify(filters || {});
  // The loading card: the first answer is the table's profile, later ones a refresh of its charts.
  const first = result.data === null;
  useChartLoadReport('profile', !ingested ? 'settled' : first ? (result.error ? 'failed' : 'loading') : 'settled');
  useChartLoadReport('chart', ingested && !first && result.loading ? 'loading' : 'settled');

  useEffect(() => {
    if (!ingested) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setResult((previous) => ({ ...previous, error: null, loading: true }));
    fetchResourceCharts(resourceId, { q, filters, lang }, { signal: controller.signal, background: looked.current })
      .then((env) => {
        if (cancelled) return;
        looked.current = true;
        setResult({ data: env.data, error: null, loading: false });
      })
      .catch((error) => {
        if (cancelled) return;
        setResult((previous) => ({ ...previous, error, loading: false }));
        if (error instanceof NotIngestedError) onUnavailable?.();
      });
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, lang, ingested, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // Preparation belongs to the resource page. Never present a limited live
  // row preview as a full-data chart.
  if (!ingested) {
    return <ChartBuilder resourceId={resourceId} q={q} filters={filters} fields={fields} queryMode={queryMode} onUnavailable={onUnavailable} />;
  }

  const choose = (value) => {
    track('chart_config', { resource_id: resourceId, setting: 'tab', value });
    setTab(value);
  };

  return (
    <div className="space-y-3">
      <div className="cq-seg w-fit">
        <button className={'cq-seg-btn' + (tab === 'insights' ? ' cq-seg-active' : '')} aria-pressed={tab === 'insights'} onClick={() => choose('insights')}>
          <SparklesIcon size={13} />
          {t('chart.insights')}
        </button>
        <button className={'cq-seg-btn' + (tab === 'custom' ? ' cq-seg-active' : '')} aria-pressed={tab === 'custom'} onClick={() => choose('custom')}>
          <ChartIcon size={13} />
          {t('chart.custom')}
        </button>
      </div>

      {tab === 'insights' ? (
        <InsightsDashboard data={result.data} loading={result.loading} error={result.error} onPin={onPin} onRetry={retry} />
      ) : result.data || result.error ? (
        <ChartBuilder resourceId={resourceId} q={q} filters={filters} fields={fields} queryMode={queryMode} onUnavailable={onUnavailable}
          model={result.data?.model} initialSpec={result.data?.builder?.default} />
      ) : (
        <div className="cq-skel h-[420px] rounded-xl" />
      )}
    </div>
  );
}
