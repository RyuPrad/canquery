// Hosted grants on top of the core runtime roles. This suite creates cluster
// roles and changes only its explicitly isolated DB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const enabled = process.env.COMMERCIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL || enabled !== process.env.SPATIAL_TEST_DATABASE_URL) {
    test('hosted runtime roles require three matching disposable database URLs', { skip: true }, () => {});
} else {
    const { Pool } = require('pg');
    const { applyRoleScript, connectAs } = require('../../integration/roleFixture.cjs');
    const { prepareResource } = require('../../services/preparationService');
    const { settlePreparationOn } = require('../db/preparationAccounting');
    const admin = new Pool({ connectionString: enabled });
    const prefix = 'hosted-runtime-role-' + randomUUID();
    const account = randomUUID(), request = randomUUID();
    const period = prefix;
    let job;
    const clients = [];
    const asRole = role => connectAs(admin, role, clients);
    before(async () => {
        await applyRoleScript(admin, path.join(__dirname, '../../../deploy/database/runtime-roles.sql'));
        await applyRoleScript(admin, path.join(__dirname, '../database/runtime-roles.sql'));
        await admin.query('INSERT INTO datasets(id,name) VALUES ($1,$1)', [prefix]);
        await admin.query("INSERT INTO resources(id,dataset_id,format,url) VALUES ($1,$1,'CSV','https://example.test/fixture.csv')", [prefix]);
        await admin.query('INSERT INTO commercial.accounts(id) VALUES ($1)', [account]);
        await admin.query(`INSERT INTO commercial.periods(id,account_id,plan,starts_at,ends_at,allowance,used,key_limit,rate_limit,concurrency)
            VALUES ($1,$2,'free',now()-interval '1 day',now()+interval '1 day',1000,100,1,30,1)`, [period, account]);
        job = await prepareResource(prefix, prefix, admin);
    });
    after(async () => {
        for (const client of clients) {
            await client.query('ROLLBACK');
            await client.query('RESET SESSION AUTHORIZATION');
            client.release();
        }
        await admin.query('DELETE FROM commercial.preparation_charges WHERE account_id=$1', [account]);
        await admin.query('DELETE FROM commercial.requests WHERE account_id=$1', [account]);
        await admin.query('DELETE FROM commercial.periods WHERE account_id=$1', [account]);
        await admin.query('DELETE FROM commercial.accounts WHERE id=$1', [account]);
        await admin.query('DELETE FROM ingest_jobs WHERE resource_id=$1', [prefix]);
        await admin.query('DELETE FROM resources WHERE id=$1', [prefix]);
        await admin.query('DELETE FROM datasets WHERE id=$1', [prefix]);
        await admin.end();
    });
    test('ingest settles the original preparation debit without auth, keys or debit-edit rights', async () => {
        await admin.query("UPDATE ingest_jobs SET status='failed' WHERE id=$1", [job.id]);
        await admin.query(`INSERT INTO commercial.requests(id,account_id,period_id,operation,credits,state,expires_at,job_id)
            VALUES ($1,$2,$3,'preparation',100,'charged',now(),$4)`, [request, account, period, job.id]);
        await admin.query(`INSERT INTO commercial.preparation_charges(request_id,job_id,account_id,period_id,credits,charged_at)
            VALUES ($1,$2,$3,$4,100,now())`, [request, job.id, account, period]);
        const client = await asRole('canquery_ingest');
        await client.query('BEGIN');
        assert.deepEqual(await settlePreparationOn(client, job.id), { outcome: 'refunded', changed: true });
        await client.query('COMMIT');
        assert.equal((await admin.query('SELECT used FROM commercial.periods WHERE id=$1', [period])).rows[0].used, '0');
        for (const sql of ['SELECT * FROM canquery_auth."user"', 'SELECT * FROM commercial.api_keys',
            'SELECT * FROM commercial.mail_outbox', 'UPDATE commercial.preparation_charges SET credits=1',
            'UPDATE commercial.periods SET allowance=2000']) await assert.rejects(client.query(sql), { code: '42501' });
        assert.deepEqual(await settlePreparationOn(client, job.id), { outcome: 'refunded', changed: false });
    });
    test('map worker has no account access', async () => {
        const client = await asRole('canquery_map');
        await assert.rejects(client.query('SELECT * FROM commercial.accounts'), { code: '42501' });
    });
}
