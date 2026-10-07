import { useState } from 'react';
import { CopyIcon, CheckIcon, PlayIcon } from '../components/Icons.jsx';
import { useLang } from '../i18n.jsx';
import { track } from '../utils/analytics.js';

function CopyButton({ text, endpoint }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      track('docs_action', { action: 'copy', endpoint, status: 'success' });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      track('docs_action', { action: 'copy', endpoint, status: 'failed' });
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
  const authenticatedExample = path.endsWith('/ops') ? example : example.replace(/^curl /gm, 'curl -H "Authorization: Bearer $CANQUERY_API_KEY" ');
  const run = async () => {
    track('docs_action', { action: 'run', endpoint: path, status: 'requested' });
    setRunning(true);
    try {
      const res = await fetch(runPath.replace('/api/v1/', '/web-api/v1/'));
      const body = await res.json();
      setResult(JSON.stringify(body, null, 2));
      track('docs_action', { action: 'run', endpoint: path, status: res.ok ? 'success' : 'http_error' });
    } catch (err) {
      track('docs_action', { action: 'run', endpoint: path, status: 'failed' });
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
          <CopyButton text={authenticatedExample} endpoint={path} />
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
      <pre className="cq-code" tabIndex={0} aria-label={path + ' · ' + t('docs.example')}>
        <code>{authenticatedExample}</code>
      </pre>
      {result && (
        <pre className="cq-code max-h-64 overflow-y-auto" tabIndex={0} aria-label={path + ' · ' + t('docs.response')}>
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
      <div className="cq-card p-5 mt-5 space-y-3"><p>{t('account.api_help')}</p><p>{t('account.credit_policy')}</p><div className="flex flex-wrap gap-4"><a className="link" href="/account">{t('account.api_keys')}</a><a className="link" href="/pricing">{t('account.pricing')}</a><a className="link" href="/api/v1/openapi.json">OpenAPI</a></div></div>
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
          example={"curl -OJ --get '" + BASE + "/api/v1/resources/RESOURCE_ID/query.csv' \\\n  --data-urlencode 'filters={\"year\":{\"op\":\"gte\",\"value\":2020}}'"}
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
          path="/api/v1/places"
          desc={t('docs.ep_places')}
          example={'curl "' + BASE + '/api/v1/places?q=Toronto&limit=10"'}
          runPath="/api/v1/places?q=Toronto&limit=10"
        />
        <Endpoint
          method="GET"
          path="/api/v1/organizations"
          desc={t('docs.ep_organizations')}
          example={'curl "' + BASE + '/api/v1/organizations?limit=10"'}
          runPath="/api/v1/organizations?limit=3"
        />
        <Endpoint
          method="GET"
          path="/api/v1/organizations/:name"
          desc={t('docs.ep_organization_detail')}
          example={'curl "' + BASE + '/api/v1/organizations/ORGANIZATION_NAME"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/sources"
          desc={t('docs.ep_sources')}
          example={'curl "' + BASE + '/api/v1/sources?place=toronto-on"'}
          runPath="/api/v1/sources?place=toronto-on"
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
          example={"curl --get '" + BASE + "/api/v1/resources/RESOURCE_ID/query' \\\n  --data-urlencode 'filters={\"year\":{\"op\":\"gte\",\"value\":2020}}' \\\n  --data-urlencode 'limit=10'"}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/map"
          desc={t('docs.ep_map')}
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID/map?bbox=-79.0,43.8,-78.7,44.0&zoom=11&limit=1000"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query (aggregated)"
          desc={t('docs.ep_query_agg')}
          example={"curl --get '" + BASE + "/api/v1/resources/RESOURCE_ID/query' \\\n  --data-urlencode 'group_by=province' --data-urlencode 'agg=count' \\\n  --data-urlencode 'sort=value desc'\n\ncurl --get '" + BASE + "/api/v1/resources/RESOURCE_ID/query' \\\n  --data-urlencode 'group_by=date' --data-urlencode 'agg=sum' \\\n  --data-urlencode 'agg_column=amount' --data-urlencode 'bucket=month' \\\n  --data-urlencode 'sort=key asc'"}
        />
        <Endpoint
          method="POST"
          path="/api/v1/resources/:id/prepare"
          desc={t('docs.ep_prepare')}
          example={'curl -X POST "' + BASE + '/api/v1/resources/RESOURCE_ID/prepare"'}
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
