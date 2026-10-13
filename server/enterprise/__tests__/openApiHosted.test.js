jest.mock('../../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../../db/pool') }));
jest.mock('../../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(),
    getResourceMapById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn()
}));
jest.mock('../../services/ckanClient', () => ({ packageList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), profileStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve(true)), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn() }));
jest.mock('../../services/preparationService', () => ({ prepareResource: jest.fn() }));
jest.mock('../../services/pmtilesMapService', () => ({ getTile: jest.fn() }));
jest.mock('../../db/ingestQueries', () => ({ getJobById: jest.fn(), enqueueJob: jest.fn() }));

const request = require('supertest');
const { buildOpenApi } = require('../../services/openApi');
const { operationFor, isPublicOperation } = require('../services/commercialOperations');
const { CREDIT_COSTS } = require('../services/commercialConfig');
const queries = require('../../db/catalogReadQueries');
const preparation = require('../../services/preparationService');
const app = require('../../app');
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

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COMMERCIAL_API_ENABLED;
    delete process.env.API_KEY_REQUIRED_AT;
});
afterAll(() => { process.env = savedEnv; });

describe('hosted contract credits', () => {
    test('every operation documents its credit cost', () => {
        for (const pathItem of Object.values(spec.paths)) {
            for (const operation of Object.values(pathItem)) expect(operation['x-credit-cost']).toBeDefined();
        }
    });

    test('all documented credit costs match public exemptions and metered operations', () => {
        let count = 0;
        for (const [path, methods] of Object.entries(spec.paths)) {
            for (const [method, operation] of Object.entries(methods)) {
                const req = { path, method: method.toUpperCase(), query: {} };
                const classified = operationFor(req);
                const expected = ['/healthz', '/readyz'].includes(path) || isPublicOperation(req) ? 0
                    : classified.name === 'preparation' ? `${CREDIT_COSTS.preparation} new job / ${classified.cost} existing`
                        : classified.name === 'query' ? `${classified.cost} row query / ${operationFor({ ...req, query: { agg: 'count' } }).cost} aggregation`
                            : classified.cost;
                expect(operation['x-credit-cost']).toBe(expected);
                count += 1;
            }
        }
        expect(count).toBe(30);
    });
});

describe('authentication documentation follows anonymous compatibility', () => {
    test('public health/ops/spec do not inherit bearer requirements', () => {
        const enabled = buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'true' } });
        expect(enabled.security).toEqual([{}, { bearerAuth: [] }]);
        const cutover = buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'true', API_KEY_REQUIRED_AT: '2026-01-02T00:00:00Z' }, now: Date.parse('2026-01-02T00:00:00Z') });
        expect(cutover.security).toEqual([{ bearerAuth: [] }]);
        expect(cutover['x-authentication'].anonymous_access).toBe(false);
        for (const route of ['/healthz', '/ops', '/openapi.json']) {
            expect(cutover.paths[route].get.security).toEqual([]);
            expect(cutover.paths[route].get['x-credit-cost']).toBe(0);
        }
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
        expect(res.body.paths['/openapi.json'].get['x-credit-cost']).toBe(0);
        expect(res.headers['x-canquery-credits-remaining']).toBeUndefined();
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
