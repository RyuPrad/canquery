jest.mock('../db/pool', () => ({ connect: jest.fn() }));
jest.mock('../db/preparationAccounting', () => ({ settlePreparationOn: jest.fn() }));

const pool = require('../db/pool');
const { enqueueJob } = require('../db/ingestQueries');
const { settlePreparationOn } = require('../db/preparationAccounting');

function clientFor({ loaded = [], queued = [], completed = [], resource = [{ id: 'public-resource' }] } = {}) {
    const client = {
        query: jest.fn(async (sql) => {
            if (sql.includes('canquery_lock_public_resource')) return { rows: [{ present: resource.length > 0 }] };
            if (sql.includes('FROM ingested_resources')) return { rows: loaded };
            if (sql.startsWith('INSERT INTO ingest_jobs')) return { rows: queued };
            if (sql.includes('UPDATE ingest_jobs')) return { rows: completed };
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
        expect(sql[2]).toContain('canquery_lock_public_resource');
        expect(sql[3]).toContain('FROM ingested_resources');
        expect(sql[4]).toMatch(/ON CONFLICT \(resource_id\).*DO UPDATE/s);
        expect(sql[5]).toBe('COMMIT');
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
        expect(sql.find(statement => statement.includes('UPDATE ingest_jobs'))).toContain('AND NOT preparation');
        expect(sql.at(-1)).toBe('COMMIT');
    });

    it('settles legitimate legacy completion while leaving preparation refresh jobs alone', async () => {
        const client = clientFor({ loaded: [{ resource_id: 'resource-2', row_count: '50' }], completed: [{ id: 7 }] });
        await enqueueJob('resource-2');
        expect(settlePreparationOn).toHaveBeenCalledWith(client, 7);
        expect(client.query.mock.calls.find(([sql]) => sql.includes('UPDATE ingest_jobs'))[0]).toContain('AND NOT preparation');
        expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    });

    it('rolls back and releases the client on enqueue failure', async () => {
        const client = clientFor();
        client.query.mockImplementation(async (sql) => {
            if (sql.startsWith('INSERT INTO ingest_jobs')) throw new Error('database failed');
            if (sql.includes('canquery_lock_public_resource')) return { rows: [{ present: true }] };
            if (sql.includes('FROM ingested_resources')) return { rows: [] };
            return { rows: [] };
        });

        await expect(enqueueJob('resource-3')).rejects.toThrow('database failed');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });

    it('rejects a retired resource or missing public parent after obtaining the resource lock', async () => {
        const client = clientFor({ resource: [], loaded: [{ resource_id: 'retired' }] });
        await expect(enqueueJob('retired')).rejects.toMatchObject({ statusCode: 404 });
        const sql = client.query.mock.calls.map(call => call[0]);
        expect(sql[1]).toContain('pg_advisory_xact_lock');
        expect(sql[2]).toContain('canquery_lock_public_resource');
        expect(sql).not.toEqual(expect.arrayContaining([expect.stringContaining('FROM ingested_resources')]));
        expect(sql.some(statement => statement.startsWith('INSERT INTO ingest_jobs'))).toBe(false);
        expect(sql.at(-1)).toBe('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });
});
