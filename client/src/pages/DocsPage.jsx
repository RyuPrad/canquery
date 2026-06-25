import { useState } from 'react';
import { CopyIcon, CheckIcon, PlayIcon } from '../components/Icons.jsx';
import { useLang } from '../i18n.jsx';

function CopyButton({ text }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context) - silently ignore.
    }
  };
  return (
    <button
      className="btn btn-xs btn-ghost rounded-md gap-1 text-base-content/50 hover:text-base-content"
      onClick={copy}
      title={t('docs.copy_tip')}
    >
      {copied ? <CheckIcon size={12} className="text-success" /> : <CopyIcon size={12} />}
      {copied ? t('docs.copied') : t('docs.copy')}
    </button>
  );
}

function Endpoint({ method, path, desc, example, runPath }) {
  const { t } = useLang();
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(runPath);
      const body = await res.json();
      setResult(JSON.stringify(body, null, 2));
    } catch (err) {
      setResult(t('docs.request_failed') + err.message);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="cq-card p-4 sm:p-5 space-y-3">
      <div className="flex gap-2.5 items-center flex-wrap">
        <span className={method === 'GET' ? 'cq-method cq-method-get' : 'cq-method cq-method-post'}>
          {method}
        </span>
        <code className="font-mono text-sm text-base-content/90">{path}</code>
        <div className="ml-auto flex items-center gap-1">
          <CopyButton text={example} />
          {runPath && (
            <button
              className="btn btn-xs btn-primary rounded-md gap-1"
              onClick={run}
              disabled={running}
            >
              <PlayIcon size={11} />
              {running ? t('docs.running') : t('docs.run')}
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-base-content/60 leading-relaxed">{desc}</p>
      <pre className="cq-code">
        <code>{example}</code>
      </pre>
      {result && (
        <pre className="cq-code max-h-64 overflow-y-auto">
          <code>{result}</code>
        </pre>
      )}
    </div>
  );
}

export default function DocsPage() {
  const { t } = useLang();
  const BASE = window.location.origin;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 cq-fade">
      <h1 className="text-3xl font-bold font-display tracking-tight pb-4">{t('docs.title')}</h1>
      <p className="text-base-content/60 max-w-2xl leading-relaxed">{t('docs.intro')}</p>
      <div className="space-y-4 mt-8">
        <Endpoint
          method="GET"
          path="/api/v1/resources/recently-unlocked"
          desc={t('docs.ep_recently_unlocked')}
          example={'curl "' + BASE + '/api/v1/resources/recently-unlocked"'}
          runPath="/api/v1/resources/recently-unlocked"
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/popular"
          desc={t('docs.ep_popular')}
          example={'curl "' + BASE + '/api/v1/resources/popular?days=7&limit=6"'}
          runPath="/api/v1/resources/popular"
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query.csv"
          desc={t('docs.ep_query_csv')}
          example={'curl -OJ "' + BASE + '/api/v1/resources/RESOURCE_ID/query.csv?filters={' + '"year":{"op":"gte","value":2020}' + '}"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/datasets"
          desc={t('docs.ep_datasets')}
          example={'curl "' + BASE + '/api/v1/datasets?q=housing&format=CSV&limit=5"'}
          runPath="/api/v1/datasets?q=housing&limit=3"
        />
        <Endpoint
          method="GET"
          path="/api/v1/datasets/:idOrName"
          desc={t('docs.ep_dataset_detail')}
          example={'curl "' + BASE + '/api/v1/datasets/some-dataset-id"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id"
          desc={t('docs.ep_resource_detail')}
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query"
          desc={t('docs.ep_query')}
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?filters={"year":{"op":"gte","value":2020}}&limit=10"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query (aggregated)"
          desc={t('docs.ep_query_agg')}
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?group_by=province&agg=count&sort=value desc"\ncurl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?group_by=date&agg=sum&agg_column=amount&bucket=month&sort=key asc"'}
        />
        <Endpoint
          method="POST"
          path="/api/v1/resources/:id/ingest"
          desc={t('docs.ep_ingest')}
          example={'curl -X POST "' + BASE + '/api/v1/resources/RESOURCE_ID/ingest"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/jobs/:id"
          desc={t('docs.ep_job')}
          example={'curl "' + BASE + '/api/v1/jobs/JOB_ID"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/stats"
          desc={t('docs.ep_stats')}
          example={'curl "' + BASE + '/api/v1/stats"'}
          runPath="/api/v1/stats"
        />
        <Endpoint
          method="GET"
          path="/api/v1/ops"
          desc={t('docs.ep_ops')}
          example={'curl "' + BASE + '/api/v1/ops"'}
          runPath="/api/v1/ops"
        />
      </div>
    </div>
  );
}
