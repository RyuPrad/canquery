jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(),
    getResourceMapById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn()
}));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), profileStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve(true)), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn() }));
jest.mock('../services/preparationService', () => ({ prepareResource: jest.fn() }));
jest.mock('../services/pmtilesMapService', () => ({ getTile: jest.fn() }));
jest.mock('../db/ingestQueries', () => ({ getJobById: jest.fn(), enqueueJob: jest.fn() }));

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { buildOpenApi } = require('../services/openApi');
const queries = require('../db/catalogReadQueries');
const ckan = require('../services/ckanClient');
const store = require('../db/storeQueries');
const preparation = require('../services/preparationService');
const jobs = require('../db/ingestQueries');
const tiles = require('../services/pmtilesMapService');
const app = require('../app');
const spec = buildOpenApi({ env: {} });
const savedEnv = { ...process.env };

function resolve(value) {
    if (!value?.$ref) return value;
    expect(value.$ref.startsWith('#/')).toBe(true);
    const found = value.$ref.slice(2).split('/').reduce((current, key) => current?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
    expect(found).toBeDefined();
    return found;
}

// Assert the documented contract against actual controller responses. This
// deliberately checks the schema features used here, not a generic validator.
function matches(value, rawSchema) {
    const schema = resolve(rawSchema);
    if (!schema) return false;
    if (schema.anyOf) return schema.anyOf.some(item => matches(value, item));
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type && ![].concat(schema.type).some(t => t === type || (t === 'integer' && Number.isInteger(value)))) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.const !== undefined && value !== schema.const) return false;
    if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false;
    if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (type === 'array' && schema.items && !value.every(item => matches(item, schema.items))) return false;
    if (type === 'object') {
        if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
        for (const [key, item] of Object.entries(value)) {
            if (schema.properties?.[key] && !matches(item, schema.properties[key])) return false;
            if (!schema.properties?.[key] && schema.additionalProperties && typeof schema.additionalProperties === 'object' && !matches(item, schema.additionalProperties)) return false;
        }
    }
    return true;
}
function responseFor(route, method, status) {
    const operation = spec.paths[route][method];
    expect(operation.responses).toHaveProperty(String(status));
    return resolve(operation.responses[status]);
}
function expectResponse(route, method, response) {
    const declared = responseFor(route, method, response.status);
    const content = response.headers['content-type']?.split(';')[0];
    if (content) {
        expect(declared.content).toHaveProperty(content);
        if (content === 'application/json') expect(matches(response.body, declared.content[content].schema)).toBe(true);
    } else {
        expect(declared.content).toBeUndefined();
        expect(response.text).toBe('');
    }
    expect(response.headers['x-request-id']).toBeDefined();
}
function resourceRow(id, extra = {}) {
    return { id, dataset_id: 'fixture-dataset', dataset_name: 'fixture-permits', dataset_title_en: 'Fixture permits', dataset_title_fr: null,
        name_en: 'Fixture CSV', name_fr: null, format: 'CSV', url: 'https://example.org/fixture.csv', size_bytes: null,
        datastore_active: true, language: 'en', last_modified: null, provenance_sources: [], places: [], ...extra };
}

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COMMERCIAL_API_ENABLED;
    delete process.env.API_KEY_REQUIRED_AT;
});
afterAll(() => { process.env = savedEnv; });

describe('OpenAPI structure and published route coverage', () => {
    test('documents every public router operation with stable translated identifiers and required path parameters', () => {
        const ids = [];
        for (const name of ['datasets', 'resources', 'organizations', 'places', 'sources', 'stats', 'insights', 'jobs', 'ops', 'blog', 'repo']) {
            const source = fs.readFileSync(path.join(__dirname, '../routes', name + '.js'), 'utf8');
            for (const match of source.matchAll(/router\.(get|post)\('([^']+)'/g)) {
                const route = ('/' + name + (match[2] === '/' ? '' : match[2])).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
                expect(spec.paths[route]?.[match[1]]).toBeDefined();
            }
        }
        for (const [route, pathItem] of Object.entries(spec.paths)) {
            for (const operation of Object.values(pathItem)) {
                expect(operation.operationId).toMatch(/^[a-z][A-Za-z0-9]+$/);
                ids.push(operation.operationId);
                expect(operation['x-summary-fr']).toBeTruthy();
                expect(operation['x-description-fr']).toBeTruthy();
                expect(operation['x-credit-cost']).toBeDefined();
                expect(spec.tags.map(tag => tag.name)).toContain(operation.tags[0]);
                for (const match of route.matchAll(/\{(\w+)\}/g)) {
                    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: match[1], in: 'path', required: true }));
                }
                for (const parameter of operation.parameters) {
                    expect(parameter.schema.type).toBeDefined();
                    expect(parameter.description).toBeTruthy();
                    expect(parameter['x-description-fr']).toBeTruthy();
                }
            }
        }
        expect(new Set(ids).size).toBe(ids.length);
        for (const header of Object.values(spec.components.headers)) expect(header['x-description-fr']).toBeTruthy();
    });

    test('all local refs resolve, and illustrative response examples match their schemas', () => {
        function visit(value) {
            if (!value || typeof value !== 'object') return;
            if (value.$ref) resolve(value);
            if (value.schema) {
                if (Object.hasOwn(value, 'example')) expect(matches(value.example, value.schema)).toBe(true);
                for (const example of Object.values(value.examples || {})) expect(matches(example.value, value.schema)).toBe(true);
            }
            for (const child of Object.values(value)) visit(child);
        }
        visit(spec);
        expect(JSON.stringify(spec).length).toBeLessThan(150000);
    });

    test('models CSV, binary, empty, root health and degraded ops responses separately', () => {
        expect(responseFor('/resources/{id}/query.csv', 'get', 200).content['text/csv']).toBeDefined();
        expect(responseFor('/resources/{id}/map/tiles/{version}/{z}/{x}/{y}.pbf', 'get', 200).content['application/x-protobuf']).toBeDefined();
        expect(spec.paths['/resources/{id}/activity'].post.responses[200]).toBeUndefined();
        expect(responseFor('/resources/{id}/activity', 'post', 204).content).toBeUndefined();
        expect(spec.paths['/healthz'].get.servers).toEqual([{ url: '/' }]);
        expect(responseFor('/ops', 'get', 503).content['application/json'].schema.properties.data).toEqual({ $ref: '#/components/schemas/Operations' });
        expect(responseFor('/resources/{id}/map', 'get', 413)).toBeDefined();
        expect(responseFor('/resources/{id}/query', 'get', 502)).toBeDefined();
    });

    test('uses effective configurable bounds and preserves the hard export cap', () => {
        const configured = buildOpenApi({ env: { MAX_QUERY_OFFSET: '25', EXPORT_MAX_ROWS: '500' } });
        expect(configured.paths['/resources/{id}/query'].get.parameters.find(p => p.name === 'offset').schema.maximum).toBe(25);
        expect(configured['x-limits'].csv_rows).toBe(500);
        expect(buildOpenApi({ env: { EXPORT_MAX_ROWS: '10001', MAX_QUERY_OFFSET: '-1' } })['x-limits']).toMatchObject({ csv_rows: 10000, query_offset: 10000 });
        expect(buildOpenApi({ env: { MAX_QUERY_OFFSET: '0' } })['x-limits'].query_offset).toBe(0);
    });
});

describe('authentication documentation follows anonymous compatibility', () => {
    test('public health/ops/spec do not inherit bearer requirements', () => {
        const enabled = buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'true' } });
        expect(enabled.security).toEqual([{}, { bearerAuth: [] }]);
        const cutover = buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'true', API_KEY_REQUIRED_AT: '2026-01-02T00:00:00Z' }, now: Date.parse('2026-01-02T00:00:00Z') });
        expect(cutover.security).toEqual([{ bearerAuth: [] }]);
        expect(cutover['x-authentication'].anonymous_access).toBe(false);
        for (const route of ['/healthz', '/ops', '/openapi.json']) expect(cutover.paths[route].get.security).toEqual([]);
        expect(buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'false', API_KEY_REQUIRED_AT: '2020-01-01' } }).security).toEqual([{}]);
        expect(buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'true', API_KEY_REQUIRED_AT: '2999-01-01' } }).security).toEqual([{}, { bearerAuth: [] }]);
    });

    test('public contract can be fetched after cutover without auth, database activity or secret disclosure', async () => {
        process.env.COMMERCIAL_API_ENABLED = 'true';
        process.env.API_KEY_REQUIRED_AT = '2020-01-01T00:00:00Z';
        process.env.BETTER_AUTH_SECRET = 'not-a-real-secret-but-at-least-32-characters';
        const res = await request(app).get('/api/v1/openapi.json').set('Authorization', 'Bearer deliberately-invalid');
        expect(res.status).toBe(200);
        expect(res.body.security).toEqual([{ bearerAuth: [] }]);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(res.body)).not.toContain(process.env.BETTER_AUTH_SECRET);
        expect(queries.getResourceById).not.toHaveBeenCalled();
        expect(preparation.prepareResource).not.toHaveBeenCalled();
        const unauthorized = await request(app).get('/api/v1/resources/missing');
        expect(unauthorized.status).toBe(401);
        expect(unauthorized.body.code).toBe('API_KEY_REQUIRED');
        expectResponse('/resources/{id}', 'get', unauthorized);
    });
});

describe('representative controller responses conform to the contract', () => {
    test('dataset pagination and resource capabilities retain their actual shape without data queries', async () => {
        queries.searchDatasets.mockResolvedValue([1, 2].map(i => ({ id: 'd' + i, name: 'dataset-' + i, title_en: 'Fixture', title_fr: null, metadata_modified: null, resource_count: 1, queryable_count: 1, provenance_sources: [] })));
        const list = await request(app).get('/api/v1/datasets?limit=1');
        expect(list.status).toBe(200);
        expect(list.body.pagination.nextCursor).toBe('1');
        expectResponse('/datasets', 'get', list);
        queries.getResourceById.mockResolvedValue(resourceRow('metadata'));
        const metadata = await request(app).get('/api/v1/resources/metadata');
        expect(metadata.status).toBe(200);
        expectResponse('/resources/{id}', 'get', metadata);
        expect(metadata.body.data.query_mode).toBe('datastore');
        expect(ckan.datastoreSearch).not.toHaveBeenCalled();
        expect(preparation.prepareResource).not.toHaveBeenCalled();
    });

    test('DataStore rows and constrained equality grammar agree with the documented query', async () => {
        queries.getResourceById.mockResolvedValue(resourceRow('live'));
        ckan.datastoreSearch.mockResolvedValue({ fields: [{ id: 'STREET_NAME', type: 'text' }], records: [{ STREET_NAME: 'EXAMPLE' }], total: 1 });
        const rows = await request(app).get('/api/v1/resources/live/query').query({ filters: '{"STREET_NAME":"EXAMPLE"}', limit: 500 });
        expect(rows.status).toBe(200);
        expectResponse('/resources/{id}/query', 'get', rows);
        expect(ckan.datastoreSearch).toHaveBeenCalledWith(expect.objectContaining({ filters: { STREET_NAME: 'EXAMPLE' }, limit: 100, offset: 0 }));
        const range = await request(app).get('/api/v1/resources/live/query').query({ filters: '{"STREET_NAME":{"op":"contains","value":"EX"}}' });
        expect(range.status).toBe(400);
        expect(range.body.hint).toBe('ingest_for_filters');
        expectResponse('/resources/{id}/query', 'get', range);
        const aggregate = await request(app).get('/api/v1/resources/live/query?group_by=STREET_NAME&agg=count');
        expect(aggregate.status).toBe(400);
        expectResponse('/resources/{id}/query', 'get', aggregate);
    });

    test('full-snapshot aggregates and profile schemas allow typed measures and nullable extrema', async () => {
        queries.getResourceById.mockResolvedValue(resourceRow('local', { ingest_status: 'ready', table_name: 'r_ab', ingested_columns: [{ id: 'STREET_NAME', type: 'TEXT' }, { id: 'VALUE', type: 'NUMERIC' }] }));
        store.aggregateStoreTable.mockResolvedValue({ records: [{ key: 'EXAMPLE', value: '2' }], total: 1 });
        const result = await request(app).get('/api/v1/resources/local/query?group_by=STREET_NAME&agg=count');
        expect(result.status).toBe(200);
        expect(result.body.meta.aggregation.agg).toBe('count');
        expectResponse('/resources/{id}/query', 'get', result);
        store.profileStoreTable.mockResolvedValue({ rowCount: 2, columns: [{ id: 'VALUE', type: 'NUMERIC', distinct: 0, nulls: 2, min: null, max: null, avg: null }] });
        const profile = await request(app).get('/api/v1/resources/local/profile');
        expect(profile.status).toBe(200);
        expectResponse('/resources/{id}/profile', 'get', profile);
    });

    test.each([
        ['limit', 0], ['offset', 10001], ['q', 'x'.repeat(201)], ['filters', 'x'.repeat(2001)]
    ])('invalid %s receives the documented 400', async (key, value) => {
        queries.getResourceById.mockResolvedValue(resourceRow('invalid'));
        const result = await request(app).get('/api/v1/resources/invalid/query').query({ [key]: value });
        expect(result.status).toBe(400);
        expectResponse('/resources/{id}/query', 'get', result);
    });

    test('unprepared, unsupported and unavailable resources produce distinct statuses', async () => {
        queries.getResourceById.mockResolvedValue(resourceRow('cold', { datastore_active: false }));
        const cold = await request(app).get('/api/v1/resources/cold/query');
        expect(cold.status).toBe(409);
        expectResponse('/resources/{id}/query', 'get', cold);
        queries.getResourceById.mockResolvedValue(resourceRow('pdf', { datastore_active: false, format: 'PDF' }));
        const unsupported = await request(app).get('/api/v1/resources/pdf/query');
        expect(unsupported.status).toBe(422);
        expect(unsupported.body.download_url).toBe('https://example.org/fixture.csv');
        expectResponse('/resources/{id}/query', 'get', unsupported);
        queries.getResourceById.mockResolvedValue(resourceRow('offline'));
        ckan.datastoreSearch.mockResolvedValue(null);
        const offline = await request(app).get('/api/v1/resources/offline/query');
        expect(offline.status).toBe(502);
        expectResponse('/resources/{id}/query', 'get', offline);
    });

    test('preparation statuses and sanitized failed jobs match the public lifecycle', async () => {
        preparation.prepareResource.mockResolvedValue({ id: 1, resource_id: 'cold', status: 'pending', created_at: '2026-01-01T00:00:00.000Z', serving_cached: false, prepared_at: null });
        const admitted = await request(app).post('/api/v1/resources/cold/prepare');
        expect(admitted.status).toBe(202);
        expectResponse('/resources/{id}/prepare', 'post', admitted);
        preparation.prepareResource.mockResolvedValue({ id: null, resource_id: 'cold', status: 'done', already_loaded: true, row_count: 2, prepared_at: '2026-01-01T00:00:00.000Z' });
        const current = await request(app).post('/api/v1/resources/cold/prepare');
        expect(current.status).toBe(200);
        expectResponse('/resources/{id}/prepare', 'post', current);
        jobs.getJobById.mockResolvedValue({ id: '1', resource_id: 'cold', status: 'failed', attempts: 1, failure_code: 'INVALID_FILE', error: 'private raw error', created_at: '2026-01-01T00:00:00.000Z', age_seconds: '30' });
        const failed = await request(app).get('/api/v1/jobs/1');
        expect(failed.status).toBe(200);
        expect(failed.body.data.failure_reason).toBe('invalid_file');
        expect(failed.body.data.error).toBe('Resource ingestion failed');
        expectResponse('/jobs/{id}', 'get', failed);
        const invalid = await request(app).get('/api/v1/jobs/0');
        expect(invalid.status).toBe(400);
        expectResponse('/jobs/{id}', 'get', invalid);
    });

    test('CSV, activity, tiles and health are not JSON envelopes', async () => {
        queries.getResourceById.mockResolvedValue(resourceRow('csv'));
        ckan.datastoreSearch.mockResolvedValue({ fields: [{ id: 'STREET_NAME', type: 'text' }], records: [{ STREET_NAME: 'EXAMPLE' }], total: 1 });
        const csv = await request(app).get('/api/v1/resources/csv/query.csv');
        expect(csv.status).toBe(200);
        expect(csv.text).toBe('STREET_NAME\nEXAMPLE\n');
        expectResponse('/resources/{id}/query.csv', 'get', csv);
        queries.getResourceById.mockResolvedValue(resourceRow('ready', { ingest_status: 'ready', table_name: 'r_ab' }));
        const activity = await request(app).post('/api/v1/resources/ready/activity');
        expect(activity.status).toBe(204);
        expectResponse('/resources/{id}/activity', 'post', activity);
        queries.getResourceMapById.mockResolvedValue({ provider: 'pmtiles' });
        tiles.getTile.mockResolvedValue(Buffer.from([0x1a, 0x00]));
        const tile = await request(app).get('/api/v1/resources/map/map/tiles/version/0/0/0.pbf');
        expect(tile.status).toBe(200);
        expectResponse('/resources/{id}/map/tiles/{version}/{z}/{x}/{y}.pbf', 'get', tile);
        tiles.getTile.mockResolvedValue(null);
        const empty = await request(app).get('/api/v1/resources/map/map/tiles/version/0/0/0.pbf');
        expect(empty.status).toBe(204);
        expectResponse('/resources/{id}/map/tiles/{version}/{z}/{x}/{y}.pbf', 'get', empty);
        queries.pingDb.mockResolvedValue(true);
        ckan.packageList.mockResolvedValue([]);
        const health = await request(app).get('/healthz');
        expect(health.status).toBe(200);
        expectResponse('/healthz', 'get', health);
        expect(health.body).toEqual({ ok: true, db: true, upstream: true });
    });

    test.each(['', '?bbox=1,2,3,4&zoom=23', '?bbox=1,2,3,4&limit=1001', '?bbox=3,2,1,4'])('invalid map bounds %s receive documented 400', async suffix => {
        const response = await request(app).get('/api/v1/resources/invalid-map/map' + suffix);
        expect(response.status).toBe(400);
        expectResponse('/resources/{id}/map', 'get', response);
    });
});
