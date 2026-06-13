import { useState } from 'react';
import { CopyIcon, CheckIcon, PlayIcon } from '../components/Icons.jsx';

function CopyButton({ text }) {
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
      title="Copy to clipboard"
    >
      {copied ? <CheckIcon size={12} className="text-success" /> : <CopyIcon size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Endpoint({ method, path, desc, example, runPath }) {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(runPath);
      const body = await res.json();
      setResult(JSON.stringify(body, null, 2));
    } catch (err) {
      setResult('Request failed: ' + err.message);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="oc-card p-4 sm:p-5 space-y-3">
      <div className="flex gap-2.5 items-center flex-wrap">
        <span className={method === 'GET' ? 'oc-method oc-method-get' : 'oc-method oc-method-post'}>
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
              {running ? 'Running...' : 'Run it'}
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-base-content/60 leading-relaxed">{desc}</p>
      <pre className="oc-code">
        <code>{example}</code>
      </pre>
      {result && (
        <pre className="oc-code max-h-64 overflow-y-auto">
          <code>{result}</code>
        </pre>
      )}
    </div>
  );
}

export default function DocsPage() {
  const BASE = window.location.origin;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 oc-fade">
      <h1 className="text-3xl font-bold font-display tracking-tight pb-4">API documentation</h1>
      <p className="text-base-content/60 max-w-2xl leading-relaxed">
        Anonymous JSON API over the mirrored open.canada.ca catalogue. Every response is wrapped in an envelope
        with data, pagination.nextCursor and meta (including the Open Government Licence attribution). Rate limit:
        120 requests per minute per IP; POST ingest: 5 per hour.
      </p>
      <div className="space-y-4 mt-8">
        <Endpoint
          method="GET"
          path="/api/v1/resources/recently-unlocked"
          desc="The most recently unlocked resources - what other visitors just made queryable."
          example={'curl "' + BASE + '/api/v1/resources/recently-unlocked"'}
          runPath="/api/v1/resources/recently-unlocked"
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/popular"
          desc="The most queried resources over a recent window. Params: days (1-30, default 7), limit (1-20, default 6)."
          example={'curl "' + BASE + '/api/v1/resources/popular?days=7&limit=6"'}
          runPath="/api/v1/resources/popular"
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query.csv"
          desc="Download the current query (same q, filters and sort parameters) as a CSV file, capped at 10,000 rows."
          example={'curl -OJ "' + BASE + '/api/v1/resources/RESOURCE_ID/query.csv?filters={' + '"year":{"op":"gte","value":2020}' + '}"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/datasets"
          desc="Full-text search over the catalogue. Params: q, org, format, keyword, limit, cursor."
          example={'curl "' + BASE + '/api/v1/datasets?q=housing&format=CSV&limit=5"'}
          runPath="/api/v1/datasets?q=housing&limit=3"
        />
        <Endpoint
          method="GET"
          path="/api/v1/datasets/:idOrName"
          desc="Dataset detail with resources tagged by query_mode: datastore, ingested, ingestable or file-only."
          example={'curl "' + BASE + '/api/v1/datasets/some-dataset-id"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id"
          desc="Resource detail including ingestion status and columns."
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query"
          desc={'The unified query endpoint. Works identically for upstream-datastore and locally-ingested resources: params q, filters (JSON), sort, limit, offset. filters accepts {"col":"value"} or {"col":{"op":"lt|gt|lte|gte|eq|contains","value":...}}. Unlocked resources also support aggregation: group_by, agg (count|sum|avg|min|max), agg_column (required unless count), bucket (year|month|day, date columns only). Aggregated responses return key/value records; sort accepts "key" or "value". Same params work on /query.csv.'}
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?filters={"year":{"op":"gte","value":2020}}&limit=10"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/resources/:id/query (aggregated)"
          desc="Example: count of rows per province, biggest first; or monthly sums over a date column."
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?group_by=province&agg=count&sort=value desc"\ncurl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?group_by=date&agg=sum&agg_column=amount&bucket=month&sort=key asc"'}
        />
        <Endpoint
          method="POST"
          path="/api/v1/resources/:id/ingest"
          desc="Idempotent enqueue of a CSV, XLSX or XLS ingest (50 MB CSV / 20 MB Excel / 1M rows caps). Returns the job. Rate limited to 5/hour."
          example={'curl -X POST "' + BASE + '/api/v1/resources/RESOURCE_ID/ingest"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/jobs/:id"
          desc="Poll an ingest job: pending, running, done or failed."
          example={'curl "' + BASE + '/api/v1/jobs/JOB_ID"'}
        />
        <Endpoint
          method="GET"
          path="/api/v1/stats"
          desc="Catalogue totals: datasets, resources, datastore-active, ingested, store bytes."
          example={'curl "' + BASE + '/api/v1/stats"'}
          runPath="/api/v1/stats"
        />
        <Endpoint
          method="GET"
          path="/api/v1/ops"
          desc="Background-job health for uptime monitors: last successful run per job (full/incremental sync, eviction, log prune). Returns 503 when any job is stale; jobs that have never run report pending without alarming."
          example={'curl "' + BASE + '/api/v1/ops"'}
          runPath="/api/v1/ops"
        />
      </div>
    </div>
  );
}
