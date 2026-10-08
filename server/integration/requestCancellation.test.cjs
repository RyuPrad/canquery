const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const enabled = process.env.COMMERCIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL || enabled !== process.env.SPATIAL_TEST_DATABASE_URL) {
    test('request cancellation requires three matching disposable database URLs', { skip: true }, () => {});
} else {
    const { createPool } = require('../db/poolFactory');
    const { withSnapshot, snapshotDb, snapshotKey } = require('../db/snapshotRead');
    const db = createPool();
    after(() => db.end());
    test('aborting a local reader terminates SQL and releases its snapshot lock promptly', async () => {
        const controller = new AbortController();
        const resource = 'cancel-fixture-' + Date.now();
        let entered, pid;
        const started = new Promise(resolve => { entered = resolve; });
        const reading = withSnapshot(resource, async () => {
            pid = (await snapshotDb().query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            entered();
            await snapshotDb().query('SELECT pg_sleep(30)');
        }, db, { signal: controller.signal });
        await started;
        controller.abort(new Error('client closed'));
        await assert.rejects(reading, /client closed/);
        let active;
        const deadline = Date.now() + 3000;
        do {
            active = (await db.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1', [pid])).rows.length > 0;
            if (active) await new Promise(resolve => setTimeout(resolve, 25));
        } while (active && Date.now() < deadline);
        assert.equal(active, false, 'cancelled SQL must not remain active on the server');
        const lease = await db.connect();
        try {
            assert.equal((await lease.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [snapshotKey(resource)])).rows[0].locked, true);
            await lease.query('SELECT pg_advisory_unlock(hashtext($1))', [snapshotKey(resource)]);
        } finally { lease.release(); }
    });
}
