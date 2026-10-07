const { operationFor, isPublicOperation } = require('../services/commercialOperations');
const { CREDIT_COSTS } = require('../services/commercialConfig');
const express = require('express');
const request = require('supertest');
const { commercialApi } = require('../middleware/commercialApi');

const operations = [
    ['/resources/MixedCaseId', {}, { name: 'metadata', cost: CREDIT_COSTS.metadata }],
    ['/resources/MixedCaseId/query', {}, { name: 'query', cost: CREDIT_COSTS.query }],
    ['/resources/MixedCaseId/query', { group_by: 'PublisherField', agg: 'count' },
        { name: 'aggregate', cost: CREDIT_COSTS.aggregate, expensive: true, bucket: 'aggregate', rate: 30 }],
    ['/resources/MixedCaseId/query.csv', {}, { name: 'export', cost: CREDIT_COSTS.export, expensive: true, bucket: 'export', rate: 10 }],
    ['/resources/MixedCaseId/profile', {}, { name: 'profile', cost: CREDIT_COSTS.profile, expensive: true, bucket: 'profile', rate: 20 }],
    ['/resources/MixedCaseId/map', {}, { name: 'map', cost: CREDIT_COSTS.map, expensive: true, bucket: 'map', rate: 60 }],
    ['/resources/MixedCaseId/map/tiles/Version/1/0/0.pbf', {}, { name: 'tile', cost: CREDIT_COSTS.tile, bucket: 'tile', rate: 240 }],
    ['/insights/featured', {}, { name: 'featured', cost: CREDIT_COSTS.featured, expensive: true }],
    ['/resources/MixedCaseId/prepare', {}, { name: 'preparation', cost: 0 }],
    ['/resources/MixedCaseId/ingest', {}, { name: 'preparation', cost: 0, bucket: 'ingest', rate: 5, seconds: 3600 }],
    ['/resources/MixedCaseId/activity', {}, { name: 'activity', cost: CREDIT_COSTS.activity }],
    ['/jobs/123', {}, { name: 'activity', cost: CREDIT_COSTS.activity }]
];

test.each(operations)('Express aliases preserve the operation price and limits for %s %j', (path, query, expected) => {
    for (const variant of [path, path + '/', path.toUpperCase(), path.toUpperCase() + '/']) {
        const req = { path: variant, query: { ...query } };
        expect(operationFor(req)).toEqual(expected);
        expect(req).toEqual({ path: variant, query });
    }
});

test.each(['group_by', 'agg', 'agg_column', 'bucket'])('aggregate validation failures reserve the aggregate weight when %s is supplied', field => {
    expect(operationFor({ path: '/resources/id/QUERY/', query: { [field]: 'invalid' } }).cost).toBe(CREDIT_COSTS.aggregate);
    expect(operationFor({ path: '/resources/id/QUERY/', query: { [field]: '' } }).cost).toBe(CREDIT_COSTS.query);
});

test.each(['/ops', '/openapi.json'])('public GET and HEAD aliases bypass credentials and metering for %s', async path => {
    const app = express();
    app.use('/api/v1', commercialApi);
    app.get('/api/v1' + path, (_req, res) => res.json({ public: true }));
    for (const variant of [path, path + '/', path.toUpperCase(), path.toUpperCase() + '/']) {
        for (const method of ['get', 'head']) {
            const response = await request(app)[method]('/API/V1' + variant).set('Authorization', 'Bearer deliberately-invalid');
            expect(response.status).toBe(200);
            expect(response.headers['x-canquery-credits-limit']).toBeUndefined();
            expect(response.headers['x-canquery-credits-remaining']).toBeUndefined();
        }
        expect(isPublicOperation({ path: variant, method: 'POST' })).toBe(false);
    }
});
