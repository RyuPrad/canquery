const { evictUntilUnderBudget } = require('../services/evictService');

function makeDb(rows, { currentById = {} } = {}) {
    const executed = [];
    const client = {
        query: jest.fn(async (sql, params) => {
            executed.push({ sql, params });
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
        query: jest.fn(async (sql, params) => ({
            rows: params && Array.isArray(params[0])
                ? rows.filter(row => !params[0].includes(row.resource_id))
                : rows
        })),
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

    test('excludes the resource being replaced from exact capacity accounting', async () => {
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
        expect(out.dropped).toBe(0);
        expect(out.totalBytesAfter).toBe(4 * GB);
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ANY($1::text[])'), [['same']]);
    });
});
