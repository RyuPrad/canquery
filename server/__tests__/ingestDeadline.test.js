const { createIngestDeadline, cancellableIngestClient } = require('../services/ingestDeadline');
const { downloadToTempFile } = require('../services/csvDownload');
const { preparationFailure } = require('../services/preparationFailure');

test('continuous download progress cannot reset the total processing deadline', async () => {
    const deadline = createIngestDeadline(60);
    let interval;
    let cancelled = false;
    const body = new ReadableStream({
        start(controller) { interval = setInterval(() => controller.enqueue(Buffer.from('x')), 5); },
        cancel() { cancelled = true; clearInterval(interval); }
    });
    try {
        await expect(downloadToTempFile('https://example.org/data.csv', {
            maxFileBytes: 100000, stallTimeoutMs: 1000, signal: deadline.signal,
            fetchImpl: async () => new Response(body)
        })).rejects.toMatchObject({ code: 'INGEST_DEADLINE' });
        expect(cancelled).toBe(true);
        expect(preparationFailure(deadline.signal.reason, 1)).toEqual({ code: 'TEMPORARY', delaySeconds: 30 });
    } finally { clearInterval(interval); deadline.dispose(); }
});

test('expired work rejects before admitting another PostgreSQL statement', async () => {
    const deadline = createIngestDeadline(10);
    const raw = { processID: 123, query: jest.fn() };
    const cancelDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const client = cancellableIngestClient(raw, cancelDb, deadline);
    try {
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(() => client.query('SELECT 1')).toThrow('deadline');
        await client.stop();
        expect(cancelDb.query).toHaveBeenCalledWith('SELECT pg_cancel_backend($1)', [123]);
        expect(raw.query).not.toHaveBeenCalled();
    } finally { deadline.dispose(); }
});

test('completed work detaches cancellation before a pool client can be reused', async () => {
    const deadline = createIngestDeadline(10);
    const cancelDb = { query: jest.fn() };
    const client = cancellableIngestClient({ processID: 123, query: jest.fn() }, cancelDb, deadline);
    await client.stop();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(cancelDb.query).not.toHaveBeenCalled();
    deadline.dispose();
});
