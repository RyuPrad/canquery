jest.mock('../db/pool', () => ({ query: jest.fn(), end: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({ listChangedSitemapPages: jest.fn(), listChangedCataloguePages: jest.fn() }));
jest.mock('../db/catalogWriteQueries', () => ({ getProgress: jest.fn(), setProgress: jest.fn() }));

const pool = require('../db/pool');
const queries = require('../db/catalogReadQueries');
const progress = require('../db/catalogWriteQueries');
const { alwaysIndexableDatasetIds } = require('../services/indexPolicy');
const { main, READERS } = require('../scripts/indexnow-submit');

const KEY = '0123456789abcdef0123456789abcdef';
const saved = { key: process.env.INDEXNOW_KEY, engines: process.env.INDEX_POLICY_ENGINES, argv: process.argv, exitCode: process.exitCode };
const restore = (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
let log;
let error;

beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    pool.end.mockResolvedValue();
    progress.getProgress.mockResolvedValue(null);
    progress.setProgress.mockResolvedValue();
    queries.listChangedSitemapPages.mockResolvedValue({ datasets: [{ id: 'policy-d', name: 'policy' }], resources: [] });
    queries.listChangedCataloguePages.mockResolvedValue({ datasets: [{ id: 'every-d', name: 'every' }], resources: [{ id: 'every-r' }] });
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.INDEXNOW_KEY = KEY;
    process.argv = ['node', 'indexnow-submit.js', '--dry-run'];
});
afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    restore('INDEXNOW_KEY', saved.key);
    restore('INDEX_POLICY_ENGINES', saved.engines);
    process.argv = saved.argv;
    // A failed run sets the exit code; it must not become the test run's.
    process.exitCode = saved.exitCode;
});

const runLog = () => pool.query.mock.calls.find(([sql]) => /INSERT INTO sync_runs/.test(sql))[1];

describe('the IndexNow job reads the pages its engines may index', () => {
    const window = { since: new Date('2026-11-14T07:45:00Z'), until: new Date('2026-11-16T07:45:00Z'), limit: 50001 };

    test('each reader asks its own query', async () => {
        await READERS.policy(window);
        expect(queries.listChangedSitemapPages).toHaveBeenCalledWith({ ...window, ids: alwaysIndexableDatasetIds() }, pool);
        expect(queries.listChangedCataloguePages).not.toHaveBeenCalled();
        await READERS.catalogue(window);
        expect(queries.listChangedCataloguePages).toHaveBeenCalledWith(window, pool);
        expect(Object.keys(READERS).sort()).toEqual(['catalogue', 'policy']);
    });

    test.each([[undefined, 'listChangedSitemapPages', 'policy'], ['', 'listChangedSitemapPages', 'policy'],
        ['all', 'listChangedSitemapPages', 'policy'], ['google', 'listChangedCataloguePages', 'every']])(
        'with INDEX_POLICY_ENGINES %p a run reads %s', async (engines, reader, name) => {
            restore('INDEX_POLICY_ENGINES', engines);
            await main();
            const other = reader === 'listChangedSitemapPages' ? 'listChangedCataloguePages' : 'listChangedSitemapPages';
            expect(queries[reader]).toHaveBeenCalledTimes(1);
            expect(queries[other]).not.toHaveBeenCalled();
            expect(log.mock.calls.flat().join(' ')).toContain('https://canquery.com/datasets/' + name);
            // A dry run sends nothing, leaves the watermark and is logged as one.
            expect(progress.setProgress).not.toHaveBeenCalled();
            expect(runLog().slice(2)).toEqual([true, 0, 'dry-run']);
            expect(process.exitCode).toBe(saved.exitCode);
            expect(pool.end).toHaveBeenCalledTimes(1);
        });

    test('a setting nobody chose fails the run before anything is read or sent', async () => {
        process.env.INDEX_POLICY_ENGINES = 'bing';
        process.argv = ['node', 'indexnow-submit.js'];
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 });
        try {
            await main();
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
        expect(queries.listChangedSitemapPages).not.toHaveBeenCalled();
        expect(queries.listChangedCataloguePages).not.toHaveBeenCalled();
        expect(progress.setProgress).not.toHaveBeenCalled();
        expect(runLog().slice(2)).toEqual([false, 0, 'INDEX_POLICY_ENGINES must be all or google']);
        expect(process.exitCode).toBe(1);
    });

    test('without a key it does nothing, whatever the policy says', async () => {
        delete process.env.INDEXNOW_KEY;
        process.env.INDEX_POLICY_ENGINES = 'google';
        await main();
        expect(queries.listChangedCataloguePages).not.toHaveBeenCalled();
        expect(pool.query).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(saved.exitCode);
    });
});
