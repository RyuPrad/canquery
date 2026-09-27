const { evictUntilUnderBudget } = require('../services/evictService');

function makeDb(rows, { currentById = {} } = {}) {
    const executed = [];
    const client = {
        query: jest.fn(async (sql, params) => {
            executed.push({ sql, params });
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
            if (sql.includes('FROM ingested_resources ir') && sql.includes('WHERE ir.resource_id = $1')) {
                const current = Object.hasOwn(currentById, params[0])
                    ? currentById[params[0]]
                    : rows.find(row => row.resource_id === params[0]);
                return { rows: current ? [current] : [] };
            }
            if (sql.startsWith('DELETE FROM ingested_resources')) {
                return { rows: [{ resource_id: params[0] }] };
            }
            return { rows: [] };
        }),
        release: jest.fn()
    };
    const db = {
        query: jest.fn(async sql => sql.includes('AS cutoff') ? { rows: [{ cutoff: '2026-02-01T00:00:00Z' }] } : { rows }),
        connect: jest.fn(async () => client),
        executed,
        client
    };
    return db;
}

const GB = 1024 * 1024 * 1024;

describe('eviction budget', () => {
    test('drops least-recently-accessed tables until under budget', async () => {
        const rows = [
            { resource_id: 'a', table_name: 'r_aaa', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'b', table_name: 'r_bbb', byte_size: String(8 * GB), last_accessed_at: '2026-02-01' },
            { resource_id: 'c', table_name: 'r_ccc', byte_size: String(5 * GB), last_accessed_at: '2026-03-01' }
        ];
        const db = makeDb(rows);
        const out = await evictUntilUnderBudget(db, { budgetBytes: 12 * GB, lockHeld: true });
        expect(out.dropped).toBe(2);
        expect(out.freedBytes).toBe(18 * GB);
        expect(out.totalBytesAfter).toBe(5 * GB);
        const dropSqls = db.executed.filter(e => e.sql.startsWith('DROP TABLE')).map(e => e.sql);
        expect(dropSqls).toEqual(['DROP TABLE IF EXISTS store."r_aaa"', 'DROP TABLE IF EXISTS store."r_bbb"']);
    });

    test('never touches catalog tables', async () => {
        const rows = [
            { resource_id: 'a', table_name: 'r_aaa', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'b', table_name: 'r_bbb', byte_size: String(8 * GB), last_accessed_at: '2026-02-01' },
            { resource_id: 'c', table_name: 'r_ccc', byte_size: String(5 * GB), last_accessed_at: '2026-03-01' }
        ];
        const db = makeDb(rows);
        await evictUntilUnderBudget(db, { budgetBytes: 12 * GB, lockHeld: true });
        const allSql = db.executed.map(e => e.sql).join(' ');
        expect(allSql.includes('datasets')).toBe(false);
        expect(allSql.includes('organizations')).toBe(false);
        expect(allSql.includes(' resources')).toBe(false);
        expect(allSql).toContain('ingested_resources');
    });

    test('does nothing when already under budget', async () => {
        const rows = [
            { resource_id: 'a', table_name: 'r_aaa', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'b', table_name: 'r_bbb', byte_size: String(8 * GB), last_accessed_at: '2026-02-01' },
            { resource_id: 'c', table_name: 'r_ccc', byte_size: String(5 * GB), last_accessed_at: '2026-03-01' }
        ];
        const db = makeDb(rows);
        const out = await evictUntilUnderBudget(db, { budgetBytes: 30 * GB, lockHeld: true });
        expect(out.dropped).toBe(0);
        expect(db.connect).not.toHaveBeenCalled();
    });

    test('dry-run never opens a client', async () => {
        const rows = [
            { resource_id: 'a', table_name: 'r_aaa', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'b', table_name: 'r_bbb', byte_size: String(8 * GB), last_accessed_at: '2026-02-01' },
            { resource_id: 'c', table_name: 'r_ccc', byte_size: String(5 * GB), last_accessed_at: '2026-03-01' }
        ];
        const db = makeDb(rows);
        const out = await evictUntilUnderBudget(db, { budgetBytes: 0, dryRun: true, lockHeld: true });
        expect(out.dropped).toBe(3);
        expect(db.connect).not.toHaveBeenCalled();
    });

    test('suspicious table names are skipped, not dropped', async () => {
        const rows = [
            { resource_id: 'x', table_name: 'datasets; DROP', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'y', table_name: 'r_e1e1', byte_size: String(10 * GB), last_accessed_at: '2026-02-01' }
        ];
        const db = makeDb(rows);
        const out = await evictUntilUnderBudget(db, { budgetBytes: 5 * GB, lockHeld: true });
        const dropSqls = db.executed.filter(e => e.sql.startsWith('DROP TABLE')).map(e => e.sql);
        expect(out.dropped).toBe(1);
        expect(dropSqls).toEqual(['DROP TABLE IF EXISTS store."r_e1e1"']);
    });

    test('rechecks a pin under lock immediately before dropping', async () => {
        const rows = [
            { resource_id: 'a', table_name: 'r_aaa', byte_size: String(10 * GB), last_accessed_at: '2026-01-01', pinned: false },
            { resource_id: 'b', table_name: 'r_bbb', byte_size: String(8 * GB), last_accessed_at: '2026-02-01', pinned: false }
        ];
        const db = makeDb(rows, {
            currentById: {
                a: { ...rows[0], pinned: true }
            }
        });
        const out = await evictUntilUnderBudget(db, { budgetBytes: 5 * GB, lockHeld: true });
        const dropSqls = db.executed.filter(e => e.sql.startsWith('DROP TABLE')).map(e => e.sql);
        expect(dropSqls).toEqual(['DROP TABLE IF EXISTS store."r_bbb"']);
        expect(out.skippedPinned).toBe(1);
        expect(out.budgetSatisfied).toBe(false);
    });

    test('takes and releases the global advisory lock by default', async () => {
        const db = makeDb([]);
        await evictUntilUnderBudget(db, { budgetBytes: 1 });
        const sql = db.executed.map(entry => entry.sql);
        expect(sql).toContain('SELECT pg_advisory_lock(hashtext($1))');
        expect(sql).toContain('SELECT pg_advisory_unlock(hashtext($1))');
    });

    test('protects the serving copy while counting its bytes during replacement', async () => {
        const rows = [
            { resource_id: 'same', table_name: 'r_a', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'keep', table_name: 'r_b', byte_size: String(4 * GB), last_accessed_at: '2026-02-01' }
        ];
        const db = makeDb(rows);
        const out = await evictUntilUnderBudget(db, {
            budgetBytes: 5 * GB,
            excludeResourceIds: ['same'],
            lockHeld: true
        });
        expect(out.dropped).toBe(1);
        expect(out.totalBytesAfter).toBe(10 * GB);
        expect(out.budgetSatisfied).toBe(false);
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ANY($1::text[])'), [['same']]);
    });
});

describe('idle table expiry', () => {
    const old = { resource_id: 'a', table_name: 'r_aaa', byte_size: '100', ready: true,
        ingested_at: '2026-01-01', last_accessed_at: '2026-01-31T23:59:59Z' };
    const options = { budgetBytes: 1000, idleHours: 24, lockHeld: true };

    test('expires at the cutoff below budget, with ingested_at fallback and unknown-age protection', async () => {
        const rows = [old, { ...old, resource_id: 'b', table_name: 'r_bbb', last_accessed_at: '2026-02-01T00:00:00Z' },
            { ...old, resource_id: 'c', table_name: 'r_ccc', last_accessed_at: '2026-02-01T00:00:00.001Z' },
            { ...old, resource_id: 'd', table_name: 'r_ddd', last_accessed_at: null },
            { ...old, resource_id: 'e', table_name: 'r_eee', last_accessed_at: null, ingested_at: null }];
        const db = makeDb(rows);
        expect(await evictUntilUnderBudget(db, options)).toMatchObject({ dropped: 3, expiredDropped: 3, budgetDropped: 0, freedBytes: 300 });
        expect(db.executed.filter(x => x.sql.startsWith('DROP')).map(x => x.sql)).toEqual([
            'DROP TABLE IF EXISTS store."r_aaa"', 'DROP TABLE IF EXISTS store."r_bbb"', 'DROP TABLE IF EXISTS store."r_ddd"'
        ]);
    });

    test('rechecks activity, snapshot identity and refresh admission after the candidate scan', async () => {
        for (const changed of [{ last_accessed_at: '2026-02-02' }, { table_name: 'r_bbb' }, { active_job: true }]) {
            const db = makeDb([old], { currentById: { a: { ...old, ...changed } } });
            expect((await evictUntilUnderBudget(db, options)).dropped).toBe(0);
            expect(db.executed.some(x => x.sql.startsWith('DROP'))).toBe(false);
        }
    });

    test('pins and active refreshes remain protected even during budget pressure', async () => {
        const db = makeDb([{ ...old, pinned: true }, { ...old, resource_id: 'b', active_job: true }]);
        expect(await evictUntilUnderBudget(db, { ...options, budgetBytes: 0 })).toMatchObject({ dropped: 0, skippedPinned: 1, skippedActive: 1, budgetSatisfied: false });
    });

    test('zero disables expiry; default ingestion eviction remains budget only', async () => {
        for (const opts of [{ budgetBytes: 1000, lockHeld: true }, { ...options, idleHours: 0 }]) {
            const db = makeDb([old]);
            expect((await evictUntilUnderBudget(db, opts)).dropped).toBe(0);
            expect(db.connect).not.toHaveBeenCalled();
        }
    });

    test('dry run reports expiry without any mutation or transaction', async () => {
        const db = makeDb([old]);
        expect(await evictUntilUnderBudget(db, { ...options, dryRun: true })).toMatchObject({ expiredDropped: 1, inventory: { expired: 1, expiredBytes: 100 } });
        expect(db.executed).toEqual([]);
    });

    test('skips busy resource admission without waiting or opening a snapshot lock', async () => {
        const db = makeDb([old]);
        db.client.query.mockImplementation(async sql => ({ rows: sql.includes('pg_try_advisory_xact_lock') ? [{ locked: false }] : [] }));
        expect(await evictUntilUnderBudget(db, options)).toMatchObject({ dropped: 0, skippedActive: 1 });
    });
});
