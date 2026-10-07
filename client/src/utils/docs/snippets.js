// These examples are exported so the exact published code can be executed against fixtures.
export const PERMITS_RESOURCE = 'ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05';
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
  return {
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
