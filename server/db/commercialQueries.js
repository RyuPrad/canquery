const { randomUUID, randomBytes, createHash } = require('crypto');
const pool = require('./pool');
const AppError = require('../utils/AppError');
const { PLANS, CREDIT_COSTS } = require('../services/commercialConfig');

function failure(message, code, status = 429, seconds = 60) {
    const err = new AppError(message, status);
    err.publicCode = code;
    if (status === 429) err.retryAfter = Math.max(1, Math.ceil(seconds));
    return err;
}
async function transaction(fn, db = pool) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally { client.release(); }
}
// A short transaction lock serializes global concurrency and budget transitions.
// Never retain this lock during upstream requests, queries or response streaming.
async function meterLock(client) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('canquery-commercial-meter'))");
}
async function accountForUser(userId, db = pool) {
    const { rows } = await db.query(`INSERT INTO commercial.accounts(id, owner_id) VALUES ($1,$2)
        ON CONFLICT(owner_id) DO UPDATE SET owner_id = EXCLUDED.owner_id RETURNING *`, [randomUUID(), userId]);
    return rows[0];
}
async function currentPeriod(client, accountId) {
    const account = await client.query('SELECT * FROM commercial.accounts WHERE id=$1', [accountId]);
    if (!account.rows[0]?.owner_id || account.rows[0].suspended_at) throw failure('Account unavailable', 'ACCOUNT_SUSPENDED', 403);
    const paid = await client.query(`SELECT * FROM commercial.periods WHERE account_id=$1
        AND plan <> 'free' AND revoked_at IS NULL AND starts_at <= now() AND ends_at > now()
        ORDER BY (plan='enterprise') DESC, starts_at DESC, id LIMIT 1`, [accountId]);
    if (paid.rows[0]) return paid.rows[0];
    const { rows } = await client.query(`INSERT INTO commercial.periods
        (id,account_id,plan,starts_at,ends_at,allowance,key_limit,rate_limit,concurrency)
        VALUES ($1::text || ':free:' || to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),$1::uuid,'free',
            date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
            (date_trunc('month',now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING *`,
    [accountId, PLANS.free.credits, PLANS.free.keys, PLANS.free.rate, PLANS.free.concurrency]);
    return rows[0];
}
function digestKey(secret) { return createHash('sha256').update(secret).digest('hex'); }
async function authenticate(secret, db = pool) {
    if (!/^cq_[A-Za-z0-9_-]{43}$/.test(secret)) throw failure('Invalid API key', 'INVALID_API_KEY', 401);
    const { rows } = await db.query(`SELECT k.id, k.account_id FROM commercial.api_keys k
        JOIN commercial.accounts a ON a.id=k.account_id
        JOIN canquery_auth."user" u ON u.id=a.owner_id
        WHERE k.digest=$1 AND k.revoked_at IS NULL AND a.suspended_at IS NULL AND u."emailVerified"`, [digestKey(secret)]);
    if (!rows[0]) throw failure('Invalid API key', 'INVALID_API_KEY', 401);
    return rows[0];
}
async function activeKeys(client, accountId) {
    return (await client.query(`SELECT id,name,prefix,created_at FROM commercial.api_keys
        WHERE account_id=$1 AND revoked_at IS NULL ORDER BY created_at,id`, [accountId])).rows;
}
async function createKey(accountId, name, db = pool) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw failure('Use a key name of 1–80 characters', 'INVALID_KEY_NAME', 400);
    return transaction(async client => {
        await meterLock(client);
        const period = await currentPeriod(client, accountId);
        if ((await activeKeys(client, accountId)).length >= period.key_limit) throw failure('Revoke an existing key before creating another', 'KEY_LIMIT', 409);
        const secret = 'cq_' + randomBytes(32).toString('base64url');
        const { rows } = await client.query(`INSERT INTO commercial.api_keys(id,account_id,name,prefix,digest)
            VALUES ($1,$2,$3,$4,$5) RETURNING id,name,prefix,created_at`, [randomUUID(), accountId, name.trim(), secret.slice(0,11), digestKey(secret)]);
        return { ...rows[0], secret };
    }, db);
}
async function revokeKey(accountId, keyId, db = pool) {
    if (!/^[0-9a-f-]{36}$/i.test(keyId)) throw failure('Key not found', 'KEY_NOT_FOUND', 404);
    const result = await db.query('UPDATE commercial.api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND account_id=$2 RETURNING id', [keyId,accountId]);
    if (!result.rows.length) throw failure('Key not found', 'KEY_NOT_FOUND', 404);
}
async function rate(client, accountId, bucket, limit, seconds = 60) {
    const { rows } = await client.query(`INSERT INTO commercial.rate_windows(account_id,bucket,starts_at,hits)
        VALUES ($1,$2,to_timestamp(floor(extract(epoch from now())/$3)*$3),1)
        ON CONFLICT(account_id,bucket,starts_at) DO UPDATE SET hits=commercial.rate_windows.hits+1 RETURNING hits,
        extract(epoch from starts_at + make_interval(secs=>$3)-now()) AS retry`, [accountId,bucket,seconds]);
    if (rows[0].hits > limit) throw failure('Request rate exceeded', 'RATE_LIMIT', 429, rows[0].retry);
}
function limits(period) {
    return { limit: Number(period.allowance), remaining: Number(period.allowance)-Number(period.used)-Number(period.reserved), resets_at: period.ends_at };
}
async function reserve(identity, operation, db = pool) {
    return transaction(async client => {
        await meterLock(client);
        const period = await currentPeriod(client, identity.account_id);
        const keys = await activeKeys(client, identity.account_id);
        if (!keys.slice(0,period.key_limit).some(k => k.id === identity.id)) throw failure('This key is disabled by the current plan', 'KEY_DISABLED', 403);
        await rate(client, identity.account_id, 'general', period.rate_limit);
        if (operation.bucket) await rate(client, identity.account_id, operation.bucket, operation.rate, operation.seconds);
        if (operation.expensive) {
            const { rows } = await client.query(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE account_id=$1)::int AS account FROM commercial.requests
                WHERE state='reserved' AND expensive`, [identity.account_id]);
            if (rows[0].total >= 4 || rows[0].account >= period.concurrency) throw failure('Concurrent request limit reached', 'CONCURRENCY_LIMIT', 429, 5);
        }
        if (limits(period).remaining < operation.cost) throw failure('API credit allowance exhausted', 'QUOTA_EXCEEDED', 429, (new Date(period.ends_at)-Date.now())/1000);
        const id = randomUUID();
        if (operation.cost > 0) {
            await client.query('UPDATE commercial.periods SET reserved=reserved+$2 WHERE id=$1', [period.id, operation.cost]);
            await client.query(`INSERT INTO commercial.requests(id,account_id,period_id,operation,credits,state,expensive,expires_at)
                VALUES ($1,$2,$3,$4,$5,'reserved',$6,now()+interval '5 minutes')`,
            [id,identity.account_id,period.id,operation.name,operation.cost,Boolean(operation.expensive)]);
            period.reserved = Number(period.reserved) + operation.cost;
        }
        return { id, accountId: identity.account_id, keyId:identity.id, operation, ...limits(period) };
    }, db);
}
async function settleOn(client, id, charge) {
    const { rows } = await client.query("SELECT * FROM commercial.requests WHERE id=$1 AND state='reserved' FOR UPDATE", [id]);
    const row = rows[0];
    if (!row) return;
    await client.query('UPDATE commercial.periods SET reserved=reserved-$2,used=used+$3 WHERE id=$1', [row.period_id,row.credits,charge ? row.credits : 0]);
    await client.query('UPDATE commercial.requests SET state=$2,finished_at=now() WHERE id=$1', [id,charge ? 'charged' : 'refunded']);
    if (charge) await client.query(`INSERT INTO commercial.usage_daily(account_id,day,operation,requests,credits)
        VALUES ($1,($2::timestamptz AT TIME ZONE 'UTC')::date,$3,1,$4)
        ON CONFLICT(account_id,day,operation) DO UPDATE SET
        requests=commercial.usage_daily.requests+1, credits=commercial.usage_daily.credits+EXCLUDED.credits`,
    [row.account_id,row.created_at,row.operation,row.credits]);
}
async function settle(id, charge, db = pool) {
    return transaction(async client => { await meterLock(client); await settleOn(client,id,charge); }, db);
}
async function abortRequest(id, db = pool) {
    return transaction(async client => {
        await meterLock(client);
        const { rows } = await client.query('SELECT * FROM commercial.requests WHERE id=$1 FOR UPDATE',[id]);
        const row = rows[0];
        if (!row || row.job_id || row.state === 'refunded') return;
        if (row.state === 'reserved') return settleOn(client,id,false);
        await client.query('UPDATE commercial.periods SET used=used-$2 WHERE id=$1',[row.period_id,row.credits]);
        await client.query("UPDATE commercial.requests SET state='refunded' WHERE id=$1",[id]);
        await client.query(`UPDATE commercial.usage_daily SET requests=requests-1,credits=credits-$4
            WHERE account_id=$1 AND day=($2::timestamptz AT TIME ZONE 'UTC')::date AND operation=$3`,
        [row.account_id,row.created_at,row.operation,row.credits]);
    },db);
}
// Invoked inside the *same transaction* that creates the new preparation job.
async function chargePreparation(client, context, jobId) {
    if (!context) return;
    await meterLock(client);
    const period = await currentPeriod(client, context.accountId);
    const keys = await activeKeys(client, context.accountId);
    if (!keys.slice(0,period.key_limit).some(k=>k.id===context.keyId)) throw failure('API key is no longer active', 'KEY_DISABLED', 403);
    const credits = CREDIT_COSTS.preparation;
    if (limits(period).remaining < credits) throw failure(`Preparation requires ${credits} API credits`, 'QUOTA_EXCEEDED', 429, (new Date(period.ends_at)-Date.now())/1000);
    await rate(client,context.accountId,'new-preparation',20,3600);
    await client.query('UPDATE commercial.periods SET reserved=reserved+$2 WHERE id=$1', [period.id,credits]);
    await client.query(`INSERT INTO commercial.requests(id,account_id,period_id,operation,credits,state,expires_at,job_id)
        VALUES ($1,$2,$3,'preparation',$5,'reserved',now(),$4)`,[context.id,context.accountId,period.id,jobId,credits]);
    await settleOn(client,context.id,true);
    await client.query(`INSERT INTO commercial.preparation_charges(request_id,job_id,account_id,period_id,credits,charged_at)
        SELECT id,job_id,account_id,period_id,credits,created_at FROM commercial.requests WHERE id=$1`, [context.id]);
    context.remaining=limits(period).remaining-credits;
}
async function dashboard(accountId, db = pool) {
    return transaction(async client => {
        await meterLock(client);
        const period = await currentPeriod(client,accountId);
        const keys = await activeKeys(client,accountId);
        const usage = await client.query(`SELECT u.day,u.operation,u.requests,u.credits,
            coalesce(r.credits,0) AS returned_credits,u.credits-coalesce(r.credits,0) AS net_credits
            FROM commercial.usage_daily u LEFT JOIN (
                SELECT (charged_at AT TIME ZONE 'UTC')::date AS day,sum(credits) AS credits
                FROM commercial.preparation_charges WHERE account_id=$1 AND outcome='refunded'
                GROUP BY (charged_at AT TIME ZONE 'UTC')::date
            ) r ON u.day=r.day AND u.operation='preparation'
            WHERE u.account_id=$1 AND u.day >= (now() AT TIME ZONE 'UTC')::date-30 ORDER BY u.day,u.operation`,[accountId]);
        const returned = Number((await client.query(`SELECT coalesce(sum(credits),0) AS credits
            FROM commercial.preparation_charges WHERE account_id=$1 AND period_id=$2 AND outcome='refunded'`,[accountId,period.id])).rows[0].credits);
        const refunds = await client.query(`SELECT c.job_id,c.credits,c.charged_at,c.resolved_at AS refunded_at,
            c.period_id,p.starts_at AS period_starts_at,p.ends_at AS period_ends_at
            FROM commercial.preparation_charges c JOIN commercial.periods p ON p.id=c.period_id
            WHERE c.account_id=$1 AND c.outcome='refunded' ORDER BY c.resolved_at DESC,c.job_id DESC LIMIT 50`,[accountId]);
        return { plan:period.plan, ...limits(period), used:Number(period.used), reserved:Number(period.reserved),
            returned_credits:returned,gross_used:Number(period.used)+returned,
            key_limit:period.key_limit, rate_limit:period.rate_limit, concurrency:period.concurrency,
            keys:keys.map((k,i)=>({...k,enabled:i<period.key_limit})),
            usage:usage.rows.map(r=>({...r,credits:Number(r.credits),returned_credits:Number(r.returned_credits),net_credits:Number(r.net_credits)})),
            preparation_refunds:refunds.rows.map(r=>({...r,credits:Number(r.credits)})) };
    },db);
}
async function maintenance(db = pool) {
    return transaction(async client => {
        await meterLock(client);
        const stale = await client.query("SELECT id FROM commercial.requests WHERE state='reserved' AND expires_at < now() LIMIT 100");
        for (const row of stale.rows) await settleOn(client,row.id,false);
        await client.query("DELETE FROM commercial.requests WHERE state<>'reserved' AND created_at<now()-interval '7 days'");
        await client.query("DELETE FROM commercial.preparation_charges WHERE outcome<>'pending' AND resolved_at<now()-interval '13 months'");
        await client.query("DELETE FROM commercial.rate_windows WHERE starts_at<now()-interval '2 days'");
        await client.query("DELETE FROM commercial.usage_daily WHERE day<(now() AT TIME ZONE 'UTC')::date-interval '13 months'");
        await client.query("DELETE FROM commercial.stripe_events WHERE processed_at<now()-interval '90 days'");
        await client.query('DELETE FROM canquery_auth.session WHERE "expiresAt"<now()');
        await client.query('DELETE FROM canquery_auth.verification WHERE "expiresAt"<now()');
        await client.query('DELETE FROM canquery_auth."rateLimit" WHERE "lastRequest" < $1', [Date.now()-86400000]);
    },db);
}
module.exports = { transaction, meterLock, accountForUser, currentPeriod, authenticate, createKey, revokeKey,
    reserve, settle, abortRequest, chargePreparation, dashboard, maintenance, failure, limits };
