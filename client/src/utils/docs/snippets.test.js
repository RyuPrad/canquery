import { createServer } from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createDocsSnippets, requestSnippets, PERMITS_RESOURCE, CABIN_RESOURCE } from './snippets.js';

const execute = promisify(execFile);
const env = { ...process.env, CANQUERY_API_KEY: 'fixture-api-key' };
let server;
let base;
let received;
let exportFailure;
let preparationCase;
let pollCount;

beforeEach(async () => {
  received = [];
  exportFailure = false;
  preparationCase = null;
  pollCount = 0;
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    received.push({ method: request.method, path: url.pathname, params: Object.fromEntries(url.searchParams), authorization: request.headers.authorization });
    if (preparationCase && (url.pathname.includes(CABIN_RESOURCE) || url.pathname.includes('/jobs/'))) {
      let status = 200;
      let data;
      if (url.pathname.includes('/jobs/')) {
        pollCount++;
        if (preparationCase === 'rate-limited' && pollCount === 1) {
          status = 429;
          response.setHeader('Retry-After', '3');
        }
        if (preparationCase === 'poll-error') status = 503;
        data = { id: 123, status: preparationCase === 'failed' ? 'failed' : preparationCase === 'pending' ? 'pending' : 'done', failure_reason: 'invalid_file' };
      } else if (url.pathname.endsWith('/prepare')) {
        status = 202;
        data = { id: 123, status: 'pending' };
      } else if (url.pathname.endsWith('/query')) {
        data = { total: 327, fields: [{ id: 'Year/Année', type: 'INTEGER' }, { id: 'Family/Famille', type: 'TEXT' }], records: [{ 'Year/Année': 2024, 'Family/Famille': 'Chironomidae' }] };
      } else {
        const ready = preparationCase === 'ready' || pollCount > 0;
        data = { query_mode: ready ? 'ingested' : 'ingestable', preparation: { supported: true, enabled: true, freshness: ready ? 'current' : 'unprepared', publisher_modified_at: '2026-01-15T13:00:18.799Z', prepared_at: ready ? '2026-10-07T03:54:32.233Z' : null } };
      }
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data, ...(status === 429 ? { error: 'Request rate exceeded' } : {}) }));
      return;
    }
    if (url.pathname.endsWith('/query.csv')) {
      response.writeHead(200, { 'Content-Type': 'text/csv', ...(exportFailure ? { 'Content-Length': '10000' } : {}) });
      response.write('STREET_NAME,PERMIT_NUM\nKING,fixture-1\n');
      if (exportFailure) setTimeout(() => response.destroy(), 10);
      else response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: url.pathname.endsWith('/query') ? { fields: [{ id: 'STREET_NAME', type: 'text' }], records: [{ STREET_NAME: 'KING' }], total: 1 } : [], pagination: { nextCursor: null }, meta: { source: 'canquery' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test.each(['curl', 'python', 'javascript'])('published %s examples execute against metadata and row fixtures', async language => {
  const snippets = createDocsSnippets(base);
  for (const key of ['first', 'metadata', 'rows']) {
    const command = snippets[key][language];
    const args = language === 'curl' ? ['bash', ['-c', command]] : language === 'python' ? ['python3', ['-c', command]] : [process.execPath, ['--input-type=module', '-e', command]];
    const { stdout } = await execute(...args, { env, timeout: 5000 });
    const result = JSON.parse(stdout);
    expect(result.meta.source).toBe('canquery');
    if (key === 'rows') expect(result.data.records).toEqual([{ STREET_NAME: 'KING' }]);
  }
  expect(received).toEqual([
    { method: 'GET', path: '/api/v1/datasets', params: { q: 'housing', limit: '2' }, authorization: 'Bearer fixture-api-key' },
    { method: 'GET', path: `/api/v1/resources/${PERMITS_RESOURCE}`, params: {}, authorization: 'Bearer fixture-api-key' },
    { method: 'GET', path: `/api/v1/resources/${PERMITS_RESOURCE}/query`, params: { filters: '{"STREET_NAME":"KING"}', limit: '10', offset: '0' }, authorization: 'Bearer fixture-api-key' },
  ]);
});

test('curl arguments preserve quoted filters and shell metacharacters literally', () => {
  const filter = JSON.stringify({ 'Publisher field': { op: 'contains', value: "O'Connor & $(printf injected); `printf unsafe`" } });
  const command = requestSnippets(base, '/api/v1/resources/fixture/query', { filters: filter }).curl;
  const shell = spawnSync('bash', ['-c', 'curl() { printf "%s\\0" "$@"; }; ' + command], { encoding: 'utf8', env });
  expect(shell.status).toBe(0);
  const args = shell.stdout.split('\0').filter(Boolean);
  expect(args).toContain(`filters=${filter}`);
  expect(args).toContain('Authorization: Bearer fixture-api-key');
});

test('CSV example publishes a successful file and leaves an interrupted download partial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canquery-docs-snippet-'));
  try {
    const command = createDocsSnippets(base).export;
    await execute('bash', ['-c', command], { env, cwd: directory, timeout: 5000 });
    expect(await readFile(join(directory, 'permits.csv'), 'utf8')).toBe('STREET_NAME,PERMIT_NUM\nKING,fixture-1\n');
    await rm(join(directory, 'permits.csv'));
    exportFailure = true;
    await expect(execute('bash', ['-c', command], { env, cwd: directory, timeout: 5000 })).rejects.toHaveProperty('code', 18);
    await expect(access(join(directory, 'permits.csv'))).rejects.toHaveProperty('code', 'ENOENT');
    expect(await readFile(join(directory, 'permits.csv.partial'), 'utf8')).toContain('KING');
    expect(received.every(request => request.params.filters === '{"STREET_NAME":"KING"}')).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('preparation recipe is an explicit authenticated POST and job polling is a GET', async () => {
  const snippets = createDocsSnippets(base);
  await execute('bash', ['-c', snippets.prepare.replace('RESOURCE_ID', 'fixture-resource')], { env, timeout: 5000 });
  await execute('bash', ['-c', snippets.job.replace('JOB_ID', '123')], { env, timeout: 5000 });
  expect(received).toEqual([
    { method: 'POST', path: '/api/v1/resources/fixture-resource/prepare', params: {}, authorization: 'Bearer fixture-api-key' },
    { method: 'GET', path: '/api/v1/jobs/123', params: {}, authorization: 'Bearer fixture-api-key' },
  ]);
});

const executeWorkflow = language => {
  const command = createDocsSnippets(base).cabinWorkflow[language];
  return execute(language === 'python' ? 'python3' : process.execPath,
    language === 'python' ? ['-c', command] : ['--input-type=module', '-e', command], { env, timeout: 8000 });
};
test.each(['python', 'javascript'])('published %s cold preparation and reuse execute the displayed requests', async language => {
  preparationCase = 'cold';
  const result = JSON.parse((await executeWorkflow(language)).stdout);
  expect(result.result.total).toBe(327);
  expect(result.prepared_at).not.toBe(result.publisher_modified_at);
  expect(received.map(r => [r.method, r.path.replace(CABIN_RESOURCE, 'RESOURCE')])).toEqual([
    ['GET', '/api/v1/resources/RESOURCE'], ['POST', '/api/v1/resources/RESOURCE/prepare'],
    ['GET', '/api/v1/jobs/123'], ['GET', '/api/v1/resources/RESOURCE'], ['GET', '/api/v1/resources/RESOURCE/query'],
  ]);
  expect(JSON.parse(received.at(-1).params.filters)).toEqual({ 'Year/Année': 2024, 'Family/Famille': 'Chironomidae' });
  expect(received.at(-1).params).toMatchObject({ sort: '_id asc', limit: '10' });
  received = [];
  preparationCase = 'ready';
  await executeWorkflow(language);
  expect(received.map(r => r.method)).toEqual(['GET', 'GET']);
  expect(received.at(-1).path).toMatch(/\/query$/);
});
test.each(['python', 'javascript'])('published %s stops at terminal failure without querying the stale result', async language => {
  preparationCase = 'failed';
  await expect(executeWorkflow(language)).rejects.toThrow(/Job 123 failed/);
  expect(received.filter(r => r.path.endsWith('/prepare'))).toHaveLength(1);
  expect(received.some(r => r.path.endsWith('/query'))).toBe(false);
});
test.each(['python', 'javascript'])('published %s honours polling Retry-After without another admission', async language => {
  preparationCase = 'rate-limited';
  const start = Date.now();
  await executeWorkflow(language);
  expect(Date.now() - start).toBeGreaterThanOrEqual(2900);
  expect(pollCount).toBe(2);
  expect(received.filter(r => r.path.endsWith('/prepare'))).toHaveLength(1);
}, 10000);

// Execute the exact published program with runtime dependencies substituted;
// accelerate only its waiting clock, leaving fixture HTTP I/O on real clocks.
const executeWorkflowRuntime = (language, { timeout = false } = {}) => {
  const command = createDocsSnippets(base).cabinWorkflow[language];
  const javascript = `
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    let clock = 0;
    const fixtureFetch = async (...args) => {
      if (${timeout} && String(args[0]).includes('/jobs/')) throw new DOMException('Fixture request timed out', 'TimeoutError');
      return fetch(...args);
    };
    await new AsyncFunction('performance', 'setTimeout', 'fetch', ${JSON.stringify(command)})(
      { now: () => clock }, (resolve, duration) => { clock += duration; resolve(); }, fixtureFetch,
    );`;
  const python = `
import time
import urllib.request
clock = [0]
time.monotonic = lambda: clock[0]
def advance(duration):
    clock[0] += duration
time.sleep = advance
original_urlopen = urllib.request.urlopen
def fixture_urlopen(req, *args, **kwargs):
    if ${timeout ? 'True' : 'False'} and '/jobs/' in req.full_url:
        raise TimeoutError('Fixture request timed out')
    return original_urlopen(req, *args, **kwargs)
urllib.request.urlopen = fixture_urlopen
exec(${JSON.stringify(command)})`;
  return execute(language === 'python' ? 'python3' : process.execPath,
    language === 'python' ? ['-c', python] : ['--input-type=module', '-e', javascript], { env, timeout: 8000 });
};
test.each(['python', 'javascript'])('published %s preserves its job ID after the bounded polling deadline', async language => {
  preparationCase = 'pending';
  let failure;
  try { await executeWorkflowRuntime(language); } catch (error) { failure = error; }
  expect(failure?.stderr).toMatch(/Stopped waiting for job 123; it may still finish/);
  expect(failure?.stderr).toMatch(/Resume polling this ID, not a new POST/);
  expect(failure?.stderr).not.toMatch(/Job 123 failed/);
  expect(pollCount).toBe(200);
  expect(received.filter(r => r.path.endsWith('/prepare'))).toHaveLength(1);
  expect(received.some(r => r.path.endsWith('/query'))).toBe(false);
});
test.each(['python', 'javascript'])('published %s preserves its job ID after an HTTP polling error', async language => {
  preparationCase = 'poll-error';
  let failure;
  try { await executeWorkflowRuntime(language); } catch (error) { failure = error; }
  expect(failure?.stderr).toMatch(/Stopped polling job 123 after a request error; its final outcome is unknown/);
  expect(failure?.stderr).toMatch(/may still finish/);
  expect(failure?.stderr).not.toMatch(/Job 123 failed/);
  expect(pollCount).toBe(1);
  expect(received.filter(r => r.path.endsWith('/prepare'))).toHaveLength(1);
  expect(received.some(r => r.path.endsWith('/query'))).toBe(false);
});
test.each(['python', 'javascript'])('published %s preserves its job ID after a request timeout', async language => {
  preparationCase = 'cold';
  let failure;
  try { await executeWorkflowRuntime(language, { timeout: true }); } catch (error) { failure = error; }
  expect(failure?.stderr).toMatch(/Stopped polling job 123 after a request error; its final outcome is unknown/);
  expect(failure?.stderr).toMatch(/Fixture request timed out/);
  expect(failure?.stderr).not.toMatch(/Job 123 failed/);
  expect(received.filter(r => r.path.endsWith('/prepare'))).toHaveLength(1);
  expect(received.some(r => r.path.endsWith('/query'))).toBe(false);
});
