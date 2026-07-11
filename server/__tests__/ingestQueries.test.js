jest.mock('../db/pool', () => ({ connect: jest.fn() }));

const pool = require('../db/pool');
const { enqueueJob } = require('../db/ingestQueries');

function clientFor({ loaded = [], queued = [] } = {}) {
    const client = {
        query: jest.fn(async (sql) => {
            if (sql.includes('FROM ingested_resources')) return { rows: loaded };
            if (sql.startsWith('INSERT INTO ingest_jobs')) return { rows: queued };
            return { rows: [], rowCount: 0 };
        }),
        release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);
    return client;
}

describe('enqueueJob', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('locks the resource, rechecks loaded state, then atomically returns the active job', async () => {
        const client = clientFor({
            queued: [{ id: 12, resource_id: 'resource-1', status: 'running', attempts: 1 }]
        });

        await expect(enqueueJob('resource-1')).resolves.toEqual(expect.objectContaining({
            id: 12,
            status: 'running'
        }));

        const sql = client.query.mock.calls.map(call => call[0]);
        expect(sql[0]).toBe('BEGIN');
        expect(sql[1]).toContain('pg_advisory_xact_lock');
        expect(sql[2]).toContain('FROM ingested_resources');
        expect(sql[3]).toMatch(/ON CONFLICT \(resource_id\).*DO UPDATE/s);
        expect(sql[4]).toBe('COMMIT');
        expect(client.query.mock.calls[1][1]).toEqual([1667329650, 'resource-1']);
    });

    it('returns loaded state without creating another public refresh job', async () => {
        const client = clientFor({
            loaded: [{
                resource_id: 'resource-2',
                ingested_at: '2026-07-01T00:00:00Z',
                row_count: '50'
            }]
        });

        await expect(enqueueJob('resource-2')).resolves.toEqual(expect.objectContaining({
            id: null,
            already_loaded: true,
            row_count: '50'
        }));
        const sql = client.query.mock.calls.map(call => call[0]);
        expect(sql.some(statement => statement.startsWith('INSERT INTO ingest_jobs'))).toBe(false);
        expect(sql.some(statement => statement.includes("status = 'pending'"))).toBe(true);
        expect(sql.at(-1)).toBe('COMMIT');
    });

    it('rolls back and releases the client on enqueue failure', async () => {
        const client = clientFor();
        client.query.mockImplementation(async (sql) => {
            if (sql.startsWith('INSERT INTO ingest_jobs')) throw new Error('database failed');
            if (sql.includes('FROM ingested_resources')) return { rows: [] };
            return { rows: [] };
        });

        await expect(enqueueJob('resource-3')).rejects.toThrow('database failed');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });
});
