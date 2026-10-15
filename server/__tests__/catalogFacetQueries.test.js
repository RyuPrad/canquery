jest.mock('../db/pool', () => ({ connect: jest.fn(), query: jest.fn() }));

const pool = require('../db/pool');
const { buildDatasetFacetQuery, readDatasetFacets } = require('../db/catalogFacetQueries');

const referenced = sql => Array.from(new Set(sql.match(/\$\d+/g) || [])).map(item => Number(item.slice(1))).sort((a, b) => a - b);

describe('buildDatasetFacetQuery', () => {
    test('an unfiltered request has no parameters or filter conditions', () => {
        const { sql, values } = buildDatasetFacetQuery({ lang: 'en' });
        expect(values).toEqual([]);
        expect(referenced(sql)).toEqual([]);
        expect(sql).not.toMatch(/selected_place|m_format|m_source|selected_keywords/);
        expect(sql).toContain('d.keywords_en ELSE d.keywords_fr');
    });

    test('every value is a parameter that the statement references, numbered without gaps', () => {
        const { sql, values } = buildDatasetFacetQuery({ q: 'parks', org: ['a', 'b'], format: ['CSV'], keyword: ['trees'],
            place: 'toronto-on', source: ['portal'], level: ['municipal'], queryable: true, mappable: true, lang: 'fr' });
        expect(referenced(sql)).toEqual(values.map((_, index) => index + 1));
        expect(values).toEqual(expect.arrayContaining([['a', 'b'], ['CSV'], ['trees'], 'toronto-on', ['portal'], ['municipal']]));
        expect(sql).toContain('d.keywords_fr ELSE d.keywords_en');
        expect(sql).toContain('WITH RECURSIVE selected_place AS');
        for (const name of ['m_format', 'm_source', 'selected_keywords', 'b.has_table', 'b.has_map']) expect(sql).toContain(name);
    });

    test('each group omits only its own condition', () => {
        const { sql } = buildDatasetFacetQuery({ format: ['CSV'], mappable: true, lang: 'en' });
        const branch = name => sql.slice(sql.indexOf(`SELECT '${name}'`), sql.indexOf('UNION ALL', sql.indexOf(`SELECT '${name}'`)));
        expect(branch('total')).toContain('b.m_format AND b.has_map');
        expect(branch('level')).toContain('b.m_format AND b.has_map');
        const counts = sql.slice(sql.indexOf('format_counts AS'), sql.indexOf("SELECT 'total'"));
        expect(counts).toContain('b.has_map');
        expect(counts).not.toContain('b.m_format');
    });

    test('language values outside en/fr never reach the SQL text', () => {
        const { sql } = buildDatasetFacetQuery({ lang: "fr'; DROP TABLE datasets; --" });
        expect(sql).not.toContain('DROP');
        expect(sql).toContain('d.keywords_en ELSE d.keywords_fr');
    });
});

describe('readDatasetFacets', () => {
    function client(queryImpl) {
        const handle = { query: jest.fn(queryImpl), release: jest.fn() };
        pool.connect.mockResolvedValue(handle);
        return handle;
    }

    beforeEach(() => jest.resetAllMocks());

    test('reads inside a bounded read-only transaction', async () => {
        const handle = client(async sql => (sql.startsWith('WITH') ? { rows: [{ facet: 'total', count: 1 }] } : { rows: [] }));
        await expect(readDatasetFacets({ lang: 'en' })).resolves.toEqual([{ facet: 'total', count: 1 }]);
        expect(handle.query.mock.calls[0][0]).toMatch(/^BEGIN READ ONLY; SET LOCAL statement_timeout = 5000; SET LOCAL jit = off; SET LOCAL work_mem = '16MB'$/);
        expect(handle.query.mock.calls.at(-1)[0]).toBe('COMMIT');
        expect(handle.release).toHaveBeenCalledWith(false);
    });

    test('rolls back on failure and discards a client that cannot roll back', async () => {
        const failure = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        let handle = client(async sql => {
            if (sql.startsWith('WITH')) throw failure;
            return { rows: [] };
        });
        await expect(readDatasetFacets({ lang: 'en' })).rejects.toBe(failure);
        expect(handle.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
        expect(handle.release).toHaveBeenCalledWith(false);

        handle = client(async sql => {
            if (sql.startsWith('WITH') || sql === 'ROLLBACK') throw failure;
            return { rows: [] };
        });
        await expect(readDatasetFacets({ lang: 'en' })).rejects.toBe(failure);
        expect(handle.release).toHaveBeenCalledWith(true);
    });

    test('a caller transaction reads its own snapshot directly', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ facet: 'total', count: 0 }] }) };
        await expect(readDatasetFacets({ lang: 'en' }, db)).resolves.toEqual([{ facet: 'total', count: 0 }]);
        expect(pool.connect).not.toHaveBeenCalled();
    });
});
