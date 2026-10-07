const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { transaction, meterLock, failure } = require('../db/commercialQueries');
const { stripeClient } = require('./billingService');
const { config } = require('./commercialConfig');

async function inspect(accountId,db=pool) {
    const account=(await db.query('SELECT * FROM commercial.accounts WHERE id=$1',[accountId])).rows[0];
    if (!account) throw failure('Account not found','ACCOUNT_NOT_FOUND',404);
    const periods=(await db.query('SELECT * FROM commercial.periods WHERE account_id=$1 ORDER BY starts_at DESC LIMIT 24',[accountId])).rows;
    const preparationCharges=(await db.query(`SELECT job_id,credits,charged_at,outcome,resolved_at,period_id,
        reversal_reason FROM commercial.preparation_charges WHERE account_id=$1 ORDER BY charged_at DESC LIMIT 100`,[accountId])).rows;
    const usage=(await db.query(`SELECT day,operation,requests,credits FROM commercial.usage_daily
        WHERE account_id=$1 AND day >= (now() AT TIME ZONE 'UTC')::date-30 ORDER BY day,operation`,[accountId])).rows;
    return {account,periods,preparation_charges:preparationCharges,usage};
}
async function setSuspended(accountId,suspended,db=pool) {
    const result=await db.query('UPDATE commercial.accounts SET suspended_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 AND owner_id IS NOT NULL RETURNING id',[accountId,suspended]);
    if (!result.rows.length) throw failure('Active owner account not found','ACCOUNT_NOT_FOUND',404);
}
function grantInput(input) {
    const {credits,keys,rate,concurrency,start,end,invoice}=input;
    if (![credits,keys,rate,concurrency].every(Number.isSafeInteger) || credits<1 || credits>1e9 || keys<1 || keys>100
        || rate<1 || rate>300 || concurrency<1 || concurrency>2) throw new Error('Enterprise limits exceed the initial capacity envelope');
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end)<=Date.parse(start)
        || Date.parse(end)-Date.parse(start)>366*86400000) throw new Error('Use a finite service period of at most one year');
    if (typeof invoice!=='string' || !/^in_[A-Za-z0-9]+$/.test(invoice)) throw new Error('A paid Stripe invoice is required');
    return input;
}
async function grant(accountId,input,stripe=stripeClient(),db=pool) {
    grantInput(input);
    const invoice=await stripe.invoices.retrieve(input.invoice);
    if (invoice.status!=='paid' || invoice.livemode!==(config().mode==='live') || invoice.currency!=='cad') throw new Error('Invoice is not paid in the configured environment and currency');
    return transaction(async client=>{
        await meterLock(client);
        const account=(await client.query('SELECT * FROM commercial.accounts WHERE id=$1',[accountId])).rows[0];
        if (!account?.owner_id || account.suspended_at || account.stripe_customer_id!==invoice.customer) throw new Error('Invoice customer does not match an active account');
        const id='enterprise:'+input.invoice;
        const prior=(await client.query('SELECT * FROM commercial.periods WHERE id=$1 OR invoice_id=$2',[id,input.invoice])).rows[0];
        if (prior) {
            if (prior.id!==id || prior.account_id!==accountId || Number(prior.allowance)!==input.credits || prior.key_limit!==input.keys
                || prior.rate_limit!==input.rate || prior.concurrency!==input.concurrency || prior.starts_at.toISOString()!==new Date(input.start).toISOString()
                || prior.ends_at.toISOString()!==new Date(input.end).toISOString()) throw new Error('Invoice already has a different grant; retain its usage');
            return prior;
        }
        return (await client.query(`INSERT INTO commercial.periods(id,account_id,plan,starts_at,ends_at,allowance,key_limit,rate_limit,concurrency,invoice_id)
            VALUES ($1,$2,'enterprise',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[id,accountId,input.start,input.end,input.credits,input.keys,input.rate,input.concurrency,input.invoice])).rows[0];
    },db);
}
async function deleteAccount(accountId,stripe,db=pool) {
    let {account}=await inspect(accountId,db);
    if (!account.owner_id) return {deleted:true};
    // Pause new key requests and checkout before contacting Stripe. A Stripe
    // failure leaves the account suspended and retryable, with identity intact.
    await setSuspended(accountId,true,db);
    // A checkout that held the account lock may have created its customer
    // while suspension waited. Use the committed identity after that barrier.
    ({account}=await inspect(accountId,db));
    if (account.stripe_customer_id) {
        stripe ||= stripeClient();
        for await(const session of stripe.checkout.sessions.list({customer:account.stripe_customer_id,status:'open',limit:100})) {
            await stripe.checkout.sessions.expire(session.id);
        }
        for await(const subscription of stripe.subscriptions.list({customer:account.stripe_customer_id,status:'all',limit:100})) {
            if (!['canceled','incomplete_expired'].includes(subscription.status)) await stripe.subscriptions.cancel(subscription.id,{invoice_now:false,prorate:false});
        }
    }
    await transaction(async client=>{
        // Match billing reconciliation's account-before-meter lock order.
        await client.query('SELECT id FROM commercial.accounts WHERE id=$1 FOR NO KEY UPDATE',[accountId]);
        await meterLock(client);
        await client.query('UPDATE commercial.api_keys SET revoked_at=coalesce(revoked_at,now()),name=$2 WHERE account_id=$1',[accountId,'Deleted account key']);
        await client.query('DELETE FROM canquery_auth.verification WHERE value=$1',[account.owner_id]);
        await client.query('DELETE FROM commercial.mail_outbox WHERE user_id=$1',[account.owner_id]);
        // Sessions and credential hashes cascade; billing
        // references and bounded usage history follow their separate retention.
        await client.query('DELETE FROM canquery_auth."user" WHERE id=$1',[account.owner_id]);
    },db);
    return {deleted:true,receipt:randomUUID()};
}
async function status(db=pool) {
    return (await db.query(`SELECT
        (SELECT count(*)::int FROM commercial.preparation_charges WHERE outcome='pending') AS unresolved_preparation_charges,
        (SELECT count(*)::int FROM commercial.preparation_charges c JOIN ingest_jobs j ON j.id=c.job_id
            WHERE c.outcome='pending' AND (j.status IN ('done','failed') OR j.published_at IS NOT NULL)) AS terminal_preparation_charges,
        (SELECT count(*)::int FROM commercial.preparation_charges c LEFT JOIN ingest_jobs j ON j.id=c.job_id
            WHERE c.outcome='pending' AND j.id IS NULL) AS missing_preparation_jobs,
        (SELECT count(*)::int FROM commercial.preparation_charges WHERE outcome='refunded') AS preparation_reversals,
        (SELECT coalesce(sum(credits),0) FROM commercial.preparation_charges WHERE outcome='refunded') AS returned_preparation_credits,
        (SELECT count(*)::int FROM commercial.requests WHERE state='reserved' AND expires_at<now()) AS expired_reservations,
        (SELECT count(*)::int FROM commercial.stripe_events WHERE processed_at IS NULL AND failure) AS billing_retries,
        (SELECT count(*)::int FROM commercial.stripe_events WHERE processed_at IS NULL AND received_at<now()-interval '15 minutes') AS delayed_billing_events,
        (SELECT count(*)::int FROM commercial.mail_outbox WHERE attempts>=5) AS failed_mail,
        (SELECT count(*)::int FROM commercial.mail_outbox WHERE created_at<now()-interval '15 minutes') AS delayed_mail`)).rows[0];
}
module.exports={inspect,setSuspended,grantInput,grant,deleteAccount,status};
