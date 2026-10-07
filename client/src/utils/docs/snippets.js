// These examples are exported so the exact published code can be executed against fixtures.
export const PERMITS_RESOURCE = 'ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05';
export const CABIN_RESOURCE = '718489a5-d132-4ee9-ab6f-0e2644297b78';
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function requestSnippets(base, path, params = {}) {
  const url = new URL(path, base).href;
  const curl = [
    `curl --fail-with-body --silent --show-error --get ${shellQuote(url)} \\`,
    '  --header "Authorization: Bearer $CANQUERY_API_KEY"',
    ...Object.entries(params).map(([key, value]) => `  --data-urlencode ${shellQuote(`${key}=${value}`)}`),
  ].map((line, index, lines) => index > 0 && index < lines.length - 1 ? `${line} \\` : line).join('\n');
  const python = `import json\nimport os\nfrom urllib.parse import urlencode\nfrom urllib.request import Request, urlopen\n\nurl = ${JSON.stringify(url)}\nparams = ${JSON.stringify(params, null, 4)}\nrequest = Request(\n    url + ("?" + urlencode(params) if params else ""),\n    headers={"Authorization": "Bearer " + os.environ["CANQUERY_API_KEY"]},\n)\nwith urlopen(request, timeout=30) as response:\n    result = json.load(response)\n    print(json.dumps(result, indent=2, ensure_ascii=False))`;
  const javascript = `// Save as example.mjs; run with Node.js 22: node example.mjs\nconst key = process.env.CANQUERY_API_KEY;\nif (!key) throw new Error('Set CANQUERY_API_KEY first');\n\nconst url = new URL(${JSON.stringify(url)});\nurl.search = new URLSearchParams(${JSON.stringify(params, null, 2)}).toString();\nconst response = await fetch(url, {\n  headers: { Authorization: \`Bearer \${key}\` },\n  signal: AbortSignal.timeout(30_000),\n});\nif (!response.ok) {\n  throw new Error(\`HTTP \${response.status}: \${await response.text()}\`);\n}\nconsole.log(JSON.stringify(await response.json(), null, 2));`;
  return { curl, python, javascript };
}

export function createDocsSnippets(base) {
  const resourcePath = `/api/v1/resources/${PERMITS_RESOURCE}`;
  const cabinPath = `/api/v1/resources/${CABIN_RESOURCE}`;
  const cabinPrepare = requestSnippets(base, `${cabinPath}/prepare`);
  cabinPrepare.curl = cabinPrepare.curl.replace('--get', '--request POST');
  cabinPrepare.python = cabinPrepare.python.replace('    headers={', '    method="POST",\n    headers={');
  cabinPrepare.javascript = cabinPrepare.javascript.replace('  headers: {', "  method: 'POST',\n  headers: {");
  return {
    cabinMetadata: requestSnippets(base, cabinPath),
    cabinRows: requestSnippets(base, `${cabinPath}/query`, { filters: JSON.stringify({ 'Year/Année': 2024, 'Family/Famille': 'Chironomidae' }), sort: '_id asc', limit: '10' }),
    cabinPrepare,
    cabinWorkflow: preparationWorkflow(base),
    first: requestSnippets(base, '/api/v1/datasets', { q: 'housing', limit: '2' }),
    discover: requestSnippets(base, '/api/v1/datasets', { q: 'building permits', source: 'toronto-open-data', limit: '5' }),
    metadata: requestSnippets(base, resourcePath),
    rows: requestSnippets(base, `${resourcePath}/query`, { filters: JSON.stringify({ STREET_NAME: 'KING' }), limit: '10', offset: '0' }),
    export: [
      `curl --fail-with-body --silent --show-error --get ${shellQuote(new URL(`${resourcePath}/query.csv`, base).href)} \\`,
      '  --header "Authorization: Bearer $CANQUERY_API_KEY" \\',
      `  --data-urlencode '${'filters={"STREET_NAME":"KING"}'}' \\`,
      '  --output permits.csv.partial && mv permits.csv.partial permits.csv',
    ].join('\n'),
    prepare: [
      `curl --fail-with-body --silent --show-error --request POST \\`,
      `  ${shellQuote(new URL('/api/v1/resources/RESOURCE_ID/prepare', base).href)} \\`,
      '  --header "Authorization: Bearer $CANQUERY_API_KEY"',
    ].join('\n'),
    job: requestSnippets(base, '/api/v1/jobs/JOB_ID').curl,
  };
}

// The exact published programs are executed in the snippet contract tests.
export function preparationWorkflow(base) {
  const url = new URL(`/api/v1/resources/${CABIN_RESOURCE}`, base).href;
  const jobs = new URL('/api/v1/jobs/', base).href;
  const javascript = `// Save as cabin.mjs; Node.js 22. Keep the key on your server.
const key = process.env.CANQUERY_API_KEY;
if (!key) throw new Error('Set CANQUERY_API_KEY first');
const resource = ${JSON.stringify(url)};
const jobs = ${JSON.stringify(jobs)};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, method = 'GET', timeout = 30_000) {
  const response = await fetch(url, {
    method, headers: { Authorization: \`Bearer \${key}\` },
    signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeout))),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(\`HTTP \${response.status}: \${body.error || 'Request failed'}\`);
    error.status = response.status;
    error.retryAfter = Math.max(3, Number(response.headers.get('Retry-After')) || 3);
    throw error;
  }
  return body.data;
}
let metadata = await request(resource);
if (metadata.query_mode !== 'ingested' || metadata.preparation.freshness !== 'current') {
  if (!metadata.preparation.supported || !metadata.preparation.enabled) {
    throw new Error('Preparation unavailable; inspect metadata and the original download.');
  }
  const admission = await request(resource + '/prepare', 'POST');
  if (admission.id !== null && admission.status !== 'done') {
    console.error(\`Preparation job \${admission.id}; keep this ID to resume polling.\`);
    const deadline = performance.now() + 10 * 60_000;
    let done = false;
    while (performance.now() < deadline) {
      let delay = 3;
      let job;
      try {
        job = await request(jobs + admission.id, 'GET', Math.min(30_000, deadline - performance.now()));
      } catch (error) {
        if (error.status !== 429) {
          throw new Error(\`Stopped polling job \${admission.id} after a request error; its final outcome is unknown. It may still finish. Resume polling this ID, not a new POST. \${error.message}\`, { cause: error });
        }
        delay = error.retryAfter;
      }
      if (job?.status === 'done') { done = true; break; }
      if (job?.status === 'failed') throw new Error(\`Job \${admission.id} failed: \${job.failure_reason || 'unavailable'}. Inspect account credit returns.\`);
      await sleep(Math.max(0, Math.min(delay * 1000, deadline - performance.now())));
    }
    if (!done) throw new Error(\`Stopped waiting for job \${admission.id}; it may still finish. Resume polling this ID, not a new POST.\`);
  }
  metadata = await request(resource);
}
if (metadata.query_mode !== 'ingested') throw new Error('No ready copy. Inspect metadata before another attempt.');
const query = new URL(resource + '/query');
query.search = new URLSearchParams({
  filters: JSON.stringify({ 'Year/Année': 2024, 'Family/Famille': 'Chironomidae' }),
  sort: '_id asc', limit: '10',
});
const result = await request(query);
console.log(JSON.stringify({
  publisher_modified_at: metadata.preparation.publisher_modified_at,
  prepared_at: metadata.preparation.prepared_at,
  retrieved_at: new Date().toISOString(), result,
}, null, 2));`;
  const python = `# Save as cabin.py; Python 3 standard library. Keep the key on your server.
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

resource = ${JSON.stringify(url)}
jobs = ${JSON.stringify(jobs)}
key = os.environ["CANQUERY_API_KEY"]

def request(url, method="GET", timeout=30):
    req = Request(url, method=method, headers={"Authorization": "Bearer " + key})
    with urlopen(req, timeout=max(0.001, timeout)) as response:
        return json.load(response)["data"]

metadata = request(resource)
if metadata["query_mode"] != "ingested" or metadata["preparation"]["freshness"] != "current":
    if not metadata["preparation"]["supported"] or not metadata["preparation"]["enabled"]:
        raise RuntimeError("Preparation unavailable; inspect metadata and the original download.")
    admission = request(resource + "/prepare", "POST")
    if admission["id"] is not None and admission["status"] != "done":
        print(f"Preparation job {admission['id']}; keep this ID to resume polling.", file=sys.stderr)
        deadline = time.monotonic() + 10 * 60
        done = False
        while time.monotonic() < deadline:
            delay = 3
            job = None
            try:
                job = request(jobs + str(admission["id"]), timeout=min(30, deadline - time.monotonic()))
            except Exception as error:
                if not isinstance(error, HTTPError) or error.code != 429:
                    raise RuntimeError(f"Stopped polling job {admission['id']} after a request error; its final outcome is unknown. It may still finish. Resume polling this ID, not a new POST. {error}") from error
                delay = max(3, float(error.headers.get("Retry-After", "3")))
            if job is not None and job["status"] == "done":
                done = True
                break
            if job is not None and job["status"] == "failed":
                raise RuntimeError(f"Job {admission['id']} failed: {job.get('failure_reason') or 'unavailable'}. Inspect account credit returns.")
            time.sleep(max(0, min(delay, deadline - time.monotonic())))
        if not done:
            raise RuntimeError(f"Stopped waiting for job {admission['id']}; it may still finish. Resume polling this ID, not a new POST.")
    metadata = request(resource)
if metadata["query_mode"] != "ingested":
    raise RuntimeError("No ready copy. Inspect metadata before another attempt.")
params = {"filters": json.dumps({"Year/Année": 2024, "Family/Famille": "Chironomidae"}), "sort": "_id asc", "limit": "10"}
result = request(resource + "/query?" + urlencode(params))
print(json.dumps({
    "publisher_modified_at": metadata["preparation"]["publisher_modified_at"],
    "prepared_at": metadata["preparation"]["prepared_at"],
    "retrieved_at": datetime.now(timezone.utc).isoformat(), "result": result,
}, indent=2, ensure_ascii=False))`;
  // Shell users follow the separately displayed inspect/POST/poll/query steps.
  return { python, javascript };
}
