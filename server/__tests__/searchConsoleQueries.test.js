jest.mock('../db/pool', () => ({}));

const queries = require('../db/searchConsoleQueries');

function day() {
    return {
        dataDate: '2026-08-19',
        searchType: 'web',
        total: { clicks: 3, impressions: 10, ctr: 0.3, position: 4.2 },
        breakdowns: [
            { dimension: 'query', value: 'oshawa data', clicks: 2, impressions: 5, ctr: 0.4, position: 2 }
        ]
    };
}

it('atomically replaces totals and all breakdown slices for a day', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const db = { connect: jest.fn().mockResolvedValue(client) };
    await queries.replaceSearchConsoleDay(day(), db);
    const sql = client.query.mock.calls.map(call => call[0].trim());
    expect(sql[0]).toBe('BEGIN');
    expect(sql.some(text => text.startsWith('INSERT INTO search_console_daily'))).toBe(true);
    expect(sql.some(text => text.startsWith('DELETE FROM search_console_breakdowns'))).toBe(true);
    expect(sql.some(text => text.startsWith('INSERT INTO search_console_breakdowns'))).toBe(true);
    expect(sql.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
});

it('rolls back and releases the client after a write failure', async () => {
    const client = {
        query: jest.fn()
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('write failed'))
            .mockResolvedValueOnce({}),
        release: jest.fn()
    };
    const db = { connect: jest.fn().mockResolvedValue(client) };
    await expect(queries.replaceSearchConsoleDay(day(), db)).rejects.toThrow('write failed');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
});
