const { dedupeById, sweepMissingDatasets } = require('../db/catalogWriteQueries');

describe('dedupeById', () => {
    test('returns an empty array for empty / nullish input', () => {
        expect(dedupeById([])).toEqual([]);
        expect(dedupeById(null)).toEqual([]);
        expect(dedupeById(undefined)).toEqual([]);
    });

    test('leaves a duplicate-free list untouched', () => {
        const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }];
        expect(dedupeById(rows)).toEqual(rows);
    });

    test('collapses duplicate ids, keeping the last occurrence', () => {
        // package_search paging can return the same package on two pages; the
        // later copy is the same record, so last-wins is safe.
        const rows = [
            { id: 'a', v: 'page0' },
            { id: 'b', v: 'page0' },
            { id: 'a', v: 'page1' }
        ];
        const out = dedupeById(rows);
        expect(out).toHaveLength(2);
        expect(out.find(r => r.id === 'a').v).toBe('page1');
        expect(out.map(r => r.id).sort()).toEqual(['a', 'b']);
    });

    test('guards the ON CONFLICT "cannot affect row a second time" footgun', () => {
        // The whole point: no id may appear twice in the deduped output, so a
        // single INSERT ... ON CONFLICT (id) statement is always safe.
        const rows = Array.from({ length: 10 }, () => ({ id: 'dup', n: Math.random() }))
            .concat([{ id: 'other', n: 1 }]);
        const out = dedupeById(rows);
        const ids = out.map(r => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.sort()).toEqual(['dup', 'other']);
    });
});

describe('sweepMissingDatasets', () => {
    test('refuses an empty authoritative catalogue', async () => {
        const db = { query: jest.fn() };
        await expect(sweepMissingDatasets(db, [])).rejects.toThrow('empty upstream id set');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('refuses a suspiciously large deletion wave', async () => {
        const db = {
            query: jest.fn().mockResolvedValueOnce({ rows: [{ total: '1000', missing: '250' }] })
        };

        await expect(sweepMissingDatasets(db, ['kept'])).rejects.toThrow('250/1000');
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('deletes missing resources before their datasets', async () => {
        const db = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [{ total: '1000', missing: '2' }] })
                .mockResolvedValueOnce({ rowCount: 7 })
                .mockResolvedValueOnce({ rowCount: 2 })
        };

        await expect(sweepMissingDatasets(db, ['a', 'b'])).resolves.toEqual({
            datasetsDeleted: 2,
            resourcesDeleted: 7
        });
        expect(db.query.mock.calls[1][0]).toContain('DELETE FROM resources');
        expect(db.query.mock.calls[2][0]).toContain('DELETE FROM datasets');
    });
});
