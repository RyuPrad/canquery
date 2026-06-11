const { evictUntilUnderBudget } = require('../services/evictService');

function makeDb(rows) {
    const executed = [];
    const client = {
        query: jest.fn(async (sql, params) => {
            executed.push({ sql, params });
            return { rows: [] };
        }),
        release: jest.fn()
    };
    const db = {
        query: jest.fn(async () => ({ rows })),
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
        const out = await evictUntilUnderBudget(db, { budgetBytes: 12 * GB });
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
        await evictUntilUnderBudget(db, { budgetBytes: 12 * GB });
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
        const out = await evictUntilUnderBudget(db, { budgetBytes: 30 * GB });
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
        const out = await evictUntilUnderBudget(db, { budgetBytes: 0, dryRun: true });
        expect(out.dropped).toBe(3);
        expect(db.connect).not.toHaveBeenCalled();
    });

    test('suspicious table names are skipped, not dropped', async () => {
        const rows = [
            { resource_id: 'x', table_name: 'datasets; DROP', byte_size: String(10 * GB), last_accessed_at: '2026-01-01' },
            { resource_id: 'y', table_name: 'r_e1e1', byte_size: String(10 * GB), last_accessed_at: '2026-02-01' }
        ];
        const db = makeDb(rows);
        const out = await evictUntilUnderBudget(db, { budgetBytes: 5 * GB });
        const dropSqls = db.executed.filter(e => e.sql.startsWith('DROP TABLE')).map(e => e.sql);
        expect(out.dropped).toBe(1);
        expect(dropSqls).toEqual(['DROP TABLE IF EXISTS store."r_e1e1"']);
    });
});
