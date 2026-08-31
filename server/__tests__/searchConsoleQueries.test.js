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

it('surfaces high-impression, low-CTR dataset and resource pages in the report data', async () => {
    const opportunity = {
        value: 'https://canquery.com/resources/r1',
        clicks: 0, impressions: 200, ctr: 0, position: 5
    };
    const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ latest_date: '2026-08-27', last_synced_at: '2026-08-29T00:00:00Z' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
            current_clicks: 1, current_impressions: 100,
            prior_clicks: 0, prior_impressions: 50,
            current_position: 5, prior_position: 6
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [opportunity] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }) };

    const report = await queries.getSearchGrowthReportData(db);

    expect(report.pageOpportunities).toEqual([opportunity]);
    const opportunitySql = db.query.mock.calls.find(call => call[0].includes('HAVING sum(impressions) >= 50'));
    expect(opportunitySql[0]).toContain("value ~ '/datasets/[^/?#]+'");
    expect(opportunitySql[0]).toContain("value ~ '/resources/[^/?#]+'");
});
