const blogContent = require('../services/blogContent');
const policy = require('../services/indexPolicy');
const { classifyResource } = require('../services/resourceCapabilities');
const { LMIA_DATASET_ID } = require('../utils/lmiaLabels');
const { OAS_DATASET_ID } = require('../utils/oasLabels');

afterEach(() => jest.restoreAllMocks());

describe('index policy - resource pages', () => {
    // Every capability a file can have, with and without a pin.
    const files = {
        'file-only': { format: 'PDF', url: 'https://example.test/a.pdf' },
        ingestable: { format: 'CSV', url: 'https://example.test/a.csv', size_bytes: 1000 },
        mapped: { format: 'PDF', url: 'https://example.test/a.pdf', map_provider: 'arcgis' },
        datastore: { format: 'CSV', url: 'https://example.test/a.csv', datastore_active: true },
        ingested: { format: 'CSV', url: 'https://example.test/a.csv', ingest_status: 'ready' }
    };

    test.each(Object.entries(files))('a %s file follows the rule, pinned or not', (capability, row) => {
        expect(classifyResource(row).capability).toBe(capability);
        // A live table is indexable on its own; a prepared copy only when it is pinned; nothing else ever.
        expect(policy.isIndexableResource({ ...row, pinned: false })).toBe(capability === 'datastore');
        expect(policy.isIndexableResource({ ...row, pinned: true })).toBe(capability === 'datastore' || capability === 'ingested');
        expect(policy.isIndexableResource(row)).toBe(capability === 'datastore');
    });

    test('a live table with an unpinned prepared copy stays indexable, and a pin alone is not a table', () => {
        expect(policy.isIndexableResource({ datastore_active: true, ingest_status: 'ready', pinned: false })).toBe(true);
        expect(policy.isIndexableResource({ pinned: true })).toBe(false);
        expect(policy.isIndexableResource({ ingest_status: 'failed', pinned: true })).toBe(false);
        expect(policy.isIndexableResource()).toBe(false);
    });
});

describe('index policy - dataset pages', () => {
    test('guide and hub datasets are always indexable, by id, sorted and without repeats', () => {
        const guides = jest.spyOn(blogContent, 'listArticles').mockReturnValue([
            { datasetId: 'zebra' }, { datasetId: 'apple' }, { datasetId: 'zebra' }, { datasetId: undefined }, { datasetId: LMIA_DATASET_ID }]);
        expect(policy.alwaysIndexableDatasetIds()).toEqual([LMIA_DATASET_ID, OAS_DATASET_ID, 'apple', 'zebra'].sort());
        // Published English editions carry every guide once; drafts never reach the list.
        expect(guides).toHaveBeenCalledWith({ lang: 'en' });
    });

    test('every published guide names a dataset id, so its dataset page stays indexable', () => {
        const articles = blogContent.listArticles({ lang: 'en' });
        expect(articles.length).toBeGreaterThan(20);
        expect(articles.filter(article => !article.datasetId)).toEqual([]);
        const ids = policy.alwaysIndexableDatasetIds();
        for (const article of articles) expect(ids).toContain(article.datasetId);
        expect(ids).toEqual(expect.arrayContaining([LMIA_DATASET_ID, OAS_DATASET_ID]));
        // The hub datasets count whether or not the hub has data in this process.
        expect([...ids].sort()).toEqual(ids);
    });

    test('a dataset is indexable with one indexable file, or as a guide or hub dataset', () => {
        jest.spyOn(blogContent, 'listArticles').mockReturnValue([{ datasetId: 'guide' }]);
        const csv = { format: 'CSV', url: 'https://example.test/a.csv' };
        expect(policy.isIndexableDataset({ id: 'd' }, [])).toBe(false);
        expect(policy.isIndexableDataset({ id: 'd' }, [csv, { ...csv, map_provider: 'arcgis' }, { ...csv, ingest_status: 'ready' }])).toBe(false);
        expect(policy.isIndexableDataset({ id: 'd' }, [csv, { ...csv, datastore_active: true }])).toBe(true);
        expect(policy.isIndexableDataset({ id: 'd' }, [{ ...csv, ingest_status: 'ready', pinned: true }])).toBe(true);
        expect(policy.isIndexableDataset({ id: 'guide' }, [])).toBe(true);
        expect(policy.isIndexableDataset({ id: 'd', name: 'guide' }, [])).toBe(false);
        expect(policy.isIndexableDataset({ id: OAS_DATASET_ID }, [])).toBe(true);
        expect(policy.isIndexableDataset()).toBe(false);
    });
});

describe('index policy - the date pages turned noindex', () => {
    test('is the built-in date unless INDEX_POLICY_SINCE gives a UTC time', () => {
        expect(policy.policySince(undefined)).toBe(policy.POLICY_SINCE);
        expect(policy.policySince('')).toBe(policy.POLICY_SINCE);
        expect(policy.policySince('  ')).toBe(policy.POLICY_SINCE);
        expect(policy.policySince(' 2026-12-01T05:00:00Z ')).toBe('2026-12-01T05:00:00Z');
        expect(policy.policySince('2026-12-01T05:00:00.250Z')).toBe('2026-12-01T05:00:00.250Z');
        expect(Number.isNaN(Date.parse(policy.POLICY_SINCE))).toBe(false);
        expect(policy.POLICY_SINCE).toMatch(/Z$/);
        expect(policy.POLICY_RECRAWL_DAYS).toBe(90);
    });

    // The last three do not exist: JavaScript would roll them over, PostgreSQL would refuse them in every read.
    test.each(['tomorrow', '2026-12-01', '2026-12-01T05:00:00', '2026-12-01T05:00:00+00:00', '2026-13-40T05:00:00Z', '1',
        '2026-11-31T00:00:00Z', '2026-02-30T10:00:00Z', '2026-11-30T24:00:00Z'])(
        'refuses %s instead of dating the recrawl sitemaps wrongly', value => {
            expect(() => policy.policySince(value)).toThrow('INDEX_POLICY_SINCE must be a UTC time');
        });

    test('reads the environment when called without a value', () => {
        const before = process.env.INDEX_POLICY_SINCE;
        try {
            process.env.INDEX_POLICY_SINCE = '2027-01-02T03:04:05Z';
            expect(policy.policySince()).toBe('2027-01-02T03:04:05Z');
            process.env.INDEX_POLICY_SINCE = 'soon';
            expect(() => policy.policySince()).toThrow('INDEX_POLICY_SINCE');
        } finally {
            if (before === undefined) delete process.env.INDEX_POLICY_SINCE; else process.env.INDEX_POLICY_SINCE = before;
        }
    });
});

describe('index policy - which search engines it speaks to', () => {
    const csv = { format: 'CSV', url: 'https://example.test/a.csv', size_bytes: 1000 };
    const files = {
        'file-only': { format: 'PDF', url: 'https://example.test/a.pdf' },
        ingestable: csv,
        mapped: { format: 'PDF', url: 'https://example.test/a.pdf', map_provider: 'arcgis' },
        datastore: { ...csv, datastore_active: true },
        ingested: { ...csv, ingest_status: 'ready' }
    };

    test('is every engine unless INDEX_POLICY_ENGINES names Google', () => {
        expect(policy.policyEngines(undefined)).toBe('all');
        expect(policy.policyEngines('')).toBe('all');
        expect(policy.policyEngines('   ')).toBe('all');
        expect(policy.policyEngines('all')).toBe('all');
        expect(policy.policyEngines(' google ')).toBe('google');
    });

    // A value nobody chose must not quietly pick an audience for 115,000 noindex tags.
    test.each(['Google', 'GOOGLE', 'googlebot', 'bing', 'google,bing', 'true', 'none', 'All', '1'])(
        'refuses %s instead of guessing', value => {
            expect(() => policy.policyEngines(value)).toThrow('INDEX_POLICY_ENGINES must be all or google');
        });

    test('reads the environment when called without a value', () => {
        const before = process.env.INDEX_POLICY_ENGINES;
        try {
            delete process.env.INDEX_POLICY_ENGINES;
            expect(policy.policyEngines()).toBe('all');
            expect(policy.resourceRobots(csv)).toEqual({ noindex: true });
            expect(policy.datasetRobots({ id: 'd' }, [csv])).toEqual({ noindex: true });
            process.env.INDEX_POLICY_ENGINES = 'google';
            expect(policy.policyEngines()).toBe('google');
            expect(policy.resourceRobots(csv)).toEqual({ noindex: true, noindexFor: 'googlebot' });
            expect(policy.datasetRobots({ id: 'd' }, [csv])).toEqual({ noindex: true, noindexFor: 'googlebot' });
            process.env.INDEX_POLICY_ENGINES = 'everyone';
            expect(() => policy.policyEngines()).toThrow('INDEX_POLICY_ENGINES');
            expect(() => policy.resourceRobots(csv)).toThrow('INDEX_POLICY_ENGINES');
            expect(() => policy.datasetRobots({ id: 'd' }, [csv])).toThrow('INDEX_POLICY_ENGINES');
        } finally {
            if (before === undefined) delete process.env.INDEX_POLICY_ENGINES; else process.env.INDEX_POLICY_ENGINES = before;
        }
    });

    test.each(Object.entries(files))('a %s file page: who its noindex tag names', (capability, row) => {
        expect(classifyResource(row).capability).toBe(capability);
        for (const pinned of [false, true]) {
            const file = { ...row, pinned };
            const indexable = policy.isIndexableResource(file);
            // To every engine, the rule is the policy's and nothing else.
            expect(policy.resourceRobots(file, 'all')).toEqual(indexable ? {} : { noindex: true });
            // To Google alone: a page that is only a download repeats its dataset page for
            // every engine, as before the policy; the pages the policy turned noindex name Google.
            const google = policy.resourceRobots(file, 'google');
            if (indexable) expect(google).toEqual({});
            else if (capability === 'file-only') expect(google).toEqual({ noindex: true });
            else expect(google).toEqual({ noindex: true, noindexFor: 'googlebot' });
        }
    });

    test('an indexable page carries no tag for anyone, whoever the policy speaks to', () => {
        for (const engines of ['all', 'google']) {
            expect(policy.resourceRobots(files.datastore, engines)).toEqual({});
            expect(policy.resourceRobots({ ...files.ingested, pinned: true }, engines)).toEqual({});
            expect(policy.datasetRobots({ id: 'd' }, [files.datastore], engines)).toEqual({});
            expect(policy.datasetRobots({ id: OAS_DATASET_ID }, [], engines)).toEqual({});
        }
        expect(policy.resourceRobots(undefined, 'google')).toEqual({ noindex: true });
        expect(policy.resourceRobots(undefined, 'all')).toEqual({ noindex: true });
    });

    test('a dataset page without a table names Google alone when the policy does, whatever its files are', () => {
        jest.spyOn(blogContent, 'listArticles').mockReturnValue([{ datasetId: 'guide' }]);
        for (const list of [[], [files['file-only']], [csv, files.mapped, files.ingested]]) {
            expect(policy.datasetRobots({ id: 'd' }, list, 'all')).toEqual({ noindex: true });
            expect(policy.datasetRobots({ id: 'd' }, list, 'google')).toEqual({ noindex: true, noindexFor: 'googlebot' });
            expect(policy.datasetRobots({ id: 'guide' }, list, 'google')).toEqual({});
        }
        expect(policy.datasetRobots(undefined, undefined, 'google')).toEqual({ noindex: true, noindexFor: 'googlebot' });
    });

    test('the shared results cannot be changed by a caller', () => {
        const first = policy.resourceRobots(csv, 'google');
        expect(() => { 'use strict'; first.noindexFor = 'robots'; }).toThrow(TypeError);
        expect(policy.resourceRobots(csv, 'google')).toEqual({ noindex: true, noindexFor: 'googlebot' });
        expect(Object.isFrozen(policy.resourceRobots(csv, 'all'))).toBe(true);
    });
});
