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

    test.each(['tomorrow', '2026-12-01', '2026-12-01T05:00:00', '2026-12-01T05:00:00+00:00', '2026-13-40T05:00:00Z', '1'])(
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
