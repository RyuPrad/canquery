const { syncMunicipalSource, mapConcurrent } = require('../services/municipalSyncService');

describe('generic municipal source orchestration', () => {
    test('summarizes included/excluded records without database writes in dry-run mode', async () => {
        const sourceAdapter = {
            discover: jest.fn().mockResolvedValue(['include', 'exclude']),
            enrichRecord: jest.fn(async value => value === 'include'
                ? { status: 'included', value: { externalId: 'one' } }
                : { status: 'excluded', reason: 'not-loadable', externalId: 'two' }),
            identityFor: jest.fn(), canonicalKey: jest.fn()
        };
        const summary = await syncMunicipalSource({ id: 'test', kind: 'test' }, {
            dryRun: true, sourceAdapter, log: { warn: jest.fn(), error: jest.fn() }
        });
        expect(summary).toEqual(expect.objectContaining({ discovered: 2, included: 1, excluded: 1, failed: 0 }));
        expect(summary.exclusion_reasons).toEqual({ 'not-loadable': 1 });
    });

    test('fails closed when metadata errors exceed the allowed fraction', async () => {
        const sourceAdapter = {
            discover: async () => [1, 2],
            enrichRecord: async () => { throw new Error('upstream failed'); },
            identityFor: () => null,
            canonicalKey: jest.fn()
        };
        await expect(syncMunicipalSource({ id: 'test', kind: 'test' }, {
            dryRun: true, sourceAdapter, maxFailureFraction: 0.1,
            log: { warn: jest.fn(), error: jest.fn() }
        })).rejects.toThrow('2/2');
    });

    test('preserves result order with bounded parallel mapping', async () => {
        const result = await mapConcurrent([3, 2, 1], 2, async value => value * 2);
        expect(result).toEqual([6, 4, 2]);
    });

    test('counts all resources and local-map candidates from a multi-resource record', async () => {
        const sourceAdapter = {
            discover: async () => ['one'],
            enrichRecord: async () => ({ status: 'included', value: {
                externalId: 'one',
                resources: [{ id: 'a', format: 'CSV' }, { id: 'b', format: 'PDF' }],
                mapCandidates: [{ resourceId: 'a' }],
                places: []
            } }),
            identityFor: value => value,
            canonicalKey: value => value
        };
        const summary = await syncMunicipalSource({ id: 'test', kind: 'test' }, {
            dryRun: true, sourceAdapter, log: { warn: jest.fn(), error: jest.fn() }
        });
        expect(summary.formats).toEqual({ CSV: 1, PDF: 1 });
        expect(summary.mappable).toBe(1);
    });
});
