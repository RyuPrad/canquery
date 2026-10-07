import { createServer } from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createDocsSnippets, requestSnippets, PERMITS_RESOURCE } from './snippets.js';

const execute = promisify(execFile);
const env = { ...process.env, CANQUERY_API_KEY: 'fixture-api-key' };
let server;
let base;
let received;
let exportFailure;

beforeEach(async () => {
  received = [];
  exportFailure = false;
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    received.push({ method: request.method, path: url.pathname, params: Object.fromEntries(url.searchParams), authorization: request.headers.authorization });
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
