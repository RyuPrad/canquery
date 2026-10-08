// This suite creates cluster roles and changes only its explicitly isolated DB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const enabled = process.env.COMMERCIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL || enabled !== process.env.SPATIAL_TEST_DATABASE_URL) {
    test('runtime roles require three matching disposable database URLs', { skip: true }, () => {});
} else {
    const { Pool } = require('pg');
    const { loadCsvIntoStore } = require('../services/csvLoad');
    const { prepareResource } = require('../services/preparationService');
    const { settlePreparationOn } = require('../db/preparationAccounting');
    const { cleanRetiredTables } = require('../services/retiredIngestTables');
    const { claimJob: claimMapJob } = require('../db/mapIndexQueries');
    const admin = new Pool({ connectionString: enabled });
    const prefix = 'runtime-role-' + randomUUID();
    const table = 'r_' + randomUUID().replaceAll('-', '');
    const account = randomUUID(), request = randomUUID();
    const period = prefix;
    let job, directory;
    const clients = [];
    const quoteId = value => '"' + value.replaceAll('"', '""') + '"';
    const quoteValue = value => "'" + value.replaceAll("'", "''") + "'";
    async function asRole(role) {
        const client = await admin.connect();
        // Unlike SET ROLE alone, SESSION AUTHORIZATION also prevents a runtime
        // identity from using the original superuser's SET ROLE authority.
        await client.query('SET SESSION AUTHORIZATION ' + quoteId(role));
        clients.push(client);
        return client;
    }
    function dbFor(client) {
        return { query: (...args) => client.query(...args), connect: async () => ({
            query: (...args) => client.query(...args), release() {}
        }) };
    }
    before(async () => {
        const { rows: [identity] } = await admin.query('SELECT current_database() AS database, current_user AS owner');
        let sql = await fs.readFile(path.join(__dirname, '../../deploy/database/runtime-roles.sql'), 'utf8');
        sql = sql.replace(/^\\.*$/gm, '').replaceAll(':"app_database"', quoteId(identity.database))
            .replaceAll(':"deploy_role"', quoteId(identity.owner)).replaceAll(":'app_database'", quoteValue(identity.database))
            .replaceAll(":'deploy_role'", quoteValue(identity.owner));
        await admin.query(sql);
        await admin.query('INSERT INTO datasets(id,name) VALUES ($1,$1)', [prefix]);
        await admin.query("INSERT INTO resources(id,dataset_id,format,url) VALUES ($1,$1,'CSV','https://example.test/fixture.csv')", [prefix]);
        await admin.query('INSERT INTO commercial.accounts(id) VALUES ($1)', [account]);
        await admin.query(`INSERT INTO commercial.periods(id,account_id,plan,starts_at,ends_at,allowance,used,key_limit,rate_limit,concurrency)
            VALUES ($1,$2,'free',now()-interval '1 day',now()+interval '1 day',1000,100,1,30,1)`, [period, account]);
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-roles-'));
    });
    after(async () => {
        for (const client of clients) {
            await client.query('ROLLBACK');
            await client.query('RESET SESSION AUTHORIZATION');
            client.release();
        }
        await admin.query('DROP TABLE IF EXISTS store.' + quoteId(table));
        await admin.query('DELETE FROM commercial.preparation_charges WHERE account_id=$1', [account]);
        await admin.query('DELETE FROM commercial.requests WHERE account_id=$1', [account]);
        await admin.query('DELETE FROM commercial.periods WHERE account_id=$1', [account]);
        await admin.query('DELETE FROM commercial.accounts WHERE id=$1', [account]);
        for (const relation of ['ingest_jobs','ingested_resources','retired_ingest_tables']) {
            await admin.query('DELETE FROM ' + relation + ' WHERE resource_id=$1', [prefix]);
        }
        await admin.query('DELETE FROM resources WHERE id=$1', [prefix]);
        await admin.query('DELETE FROM datasets WHERE id=$1', [prefix]);
        if (directory) await fs.rm(directory, { recursive: true });
        await admin.end();
    });
    test('runtime identities cannot change catalogue, pins, code-owned schema or the deployment role', async () => {
        const { rows: [owner] } = await admin.query('SELECT current_user AS name');
        for (const role of ['canquery_api','canquery_ingest','canquery_map']) {
            const client = await asRole(role);
            for (const sql of ['UPDATE resources SET name_en=name_en WHERE false',
                'INSERT INTO pinned_resources(resource_id) VALUES (\'forbidden\')',
                'CREATE TABLE public.runtime_forbidden(id int)', 'SET ROLE ' + quoteId(owner.name),
                'SELECT * FROM search_console_daily LIMIT 0']) {
                await assert.rejects(client.query(sql), { code: '42501' });
            }
        }
    });
    test('API admits work and takes narrow catalogue locks without arbitrary writes', async () => {
        const client = await asRole('canquery_api');
        job = await prepareResource(prefix, prefix, dbFor(client));
        assert.equal(job.status, 'pending');
        await client.query('BEGIN');
        assert.equal((await client.query('SELECT public.canquery_lock_public_resource($1) AS present', [prefix])).rows[0].present, true);
        const other = await admin.connect();
        try {
            await other.query('BEGIN');
            await other.query("SET LOCAL lock_timeout='50ms'");
            await assert.rejects(other.query('DELETE FROM resources WHERE id=$1', [prefix]), { code: '55P03' });
        } finally { await other.query('ROLLBACK'); other.release(); }
        await client.query('COMMIT');
        await assert.rejects(client.query('SELECT public.canquery_lock_pins()'), { code: '42501' });
        await assert.rejects(client.query('CREATE TABLE store.r_ffff(_id int)'), { code: '42501' });
    });
    test('ingest builds a shared-owner snapshot that API can read and deployment can retire', async () => {
        const client = await asRole('canquery_ingest');
        const filePath = path.join(directory, 'input.csv');
        await fs.writeFile(filePath, 'code,amount\n00123,7\n00234,9\n');
        process.env.CANQUERY_STORE_OWNER_ROLE = 'canquery_store_owner';
        try {
            await client.query('BEGIN');
            const loaded = await loadCsvIntoStore(client, { filePath, tableName: table, delimiter: ',', encoding: 'utf8', maxRows: 10, maxCols: 10 });
            await client.query('SELECT public.canquery_lock_resource_publication($1)', [prefix]);
            await client.query(`INSERT INTO ingested_resources(resource_id,table_name,row_count,columns)
                VALUES ($1,$2,$3,$4)`, [prefix, table, loaded.rowCount, JSON.stringify(loaded.columns)]);
            await client.query('SELECT public.canquery_lock_pins()');
            await client.query('COMMIT');
        } finally { delete process.env.CANQUERY_STORE_OWNER_ROLE; }
        assert.equal((await admin.query('SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass', ['store.' + table])).rows[0].owner,
            'canquery_store_owner');
        const api = await asRole('canquery_api');
        const { rows } = await api.query('SELECT code FROM store.' + quoteId(table) + ' ORDER BY _id');
        assert.deepEqual(rows.map(row => row.code), ['00123','00234']);
        await assert.rejects(api.query('DROP TABLE store.' + quoteId(table)), { code: '42501' });
        await assert.rejects(api.query('UPDATE store.' + quoteId(table) + ' SET amount=0'), { code: '42501' });
        await api.query('UPDATE ingested_resources SET last_accessed_at=now() WHERE resource_id=$1', [prefix]);
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
    test('map worker claims its queue and transforms geometry without account or snapshot access', async () => {
        await admin.query("INSERT INTO map_index_jobs(resource_id,desired_version,candidate) VALUES ($1,'fixture','{}')", [prefix]);
        const client = await asRole('canquery_map');
        const claimed = await claimMapJob(dbFor(client), randomUUID(), prefix);
        assert.equal(claimed.resource_id, prefix);
        await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE map_stage(geom geometry(Geometry,4326)) ON COMMIT DROP');
        await client.query('INSERT INTO map_stage VALUES (ST_SetSRID(ST_Point(-79,43),4326))');
        await client.query("INSERT INTO map_store.features(resource_id,feature_id,geom) SELECT $1,1,geom FROM map_stage", [prefix]);
        await client.query('COMMIT');
        await assert.rejects(client.query('SELECT * FROM commercial.accounts'), { code: '42501' });
        await assert.rejects(client.query('SELECT * FROM store.' + quoteId(table)), { code: '42501' });
    });
    test('ingest retirement can drop shared snapshots and pins remain protected', async () => {
        const client = await asRole('canquery_ingest');
        await client.query(`INSERT INTO retired_ingest_tables(table_name,resource_id,byte_size) VALUES ($1,$2,1)`, [table,prefix]);
        await client.query('DELETE FROM ingested_resources WHERE resource_id=$1', [prefix]);
        await cleanRetiredTables(dbFor(client));
        assert.equal((await admin.query('SELECT to_regclass($1) AS name', ['store.' + table])).rows[0].name, null);
    });
}
