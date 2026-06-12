import { useState } from 'react';

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
    <div className="card bg-base-200 p-4 space-y-2">
      <div className="flex gap-2 items-center">
        <span className={`badge ${method === 'GET' ? 'badge-success' : 'badge-warning'} font-mono text-xs`}>
          {method}
        </span>
        <code className="font-mono text-sm">{path}</code>
        {runPath && (
          <button className="btn btn-xs bg-[#d52b1e] text-white border-none ml-auto" onClick={run} disabled={running}>
            {running ? 'Running...' : 'Run it'}
          </button>
        )}
      </div>
      <p className="text-sm opacity-70">{desc}</p>
      <pre className="bg-base-300 rounded p-3 text-xs overflow-x-auto">
        <code>{example}</code>
      </pre>
      {result && (
        <pre className="bg-base-300 rounded p-3 text-xs overflow-x-auto max-h-64">
          <code>{result}</code>
        </pre>
      )}
    </div>
  );
}

export default function DocsPage() {
  const BASE = window.location.origin;

  return (
    <div>
      <h1 className="text-3xl font-bold py-6">API documentation</h1>
      <p className="opacity-70 max-w-2xl">
        Anonymous JSON API over the mirrored open.canada.ca catalogue. Every response is wrapped in an envelope
        with data, pagination.nextCursor and meta (including the Open Government Licence attribution). Rate limit:
        120 requests per minute per IP; POST ingest: 5 per hour.
      </p>
      <div className="space-y-4 mt-6">
        <Endpoint
          method="GET"
          path="/api/v1/resources/recently-unlocked"
          desc="The most recently unlocked resources - what other visitors just made queryable."
          example={'curl "' + BASE + '/api/v1/resources/recently-unlocked"'}
          runPath="/api/v1/resources/recently-unlocked"
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
          desc={'The unified query endpoint. Works identically for upstream-datastore and locally-ingested resources: params q, filters (JSON), sort, limit, offset. filters accepts {"col":"value"} or {"col":{"op":"lt|gt|lte|gte|eq|contains","value":...}}.'}
          example={'curl "' + BASE + '/api/v1/resources/RESOURCE_ID/query?filters={"year":{"op":"gte","value":2020}}&limit=10"'}
        />
        <Endpoint
          method="POST"
          path="/api/v1/resources/:id/ingest"
          desc="Idempotent enqueue of a CSV ingest (50 MB / 1M rows caps). Returns the job. Rate limited to 5/hour."
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
      </div>
    </div>
  );
}
