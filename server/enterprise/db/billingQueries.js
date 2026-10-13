const { meterLock } = require('./commercialQueries');

async function lockAccount(client, accountId) {
    return (await client.query('SELECT * FROM commercial.accounts WHERE id=$1 FOR NO KEY UPDATE', [accountId])).rows[0];
}

async function storeCustomer(client, accountId, customer) {
    await client.query('UPDATE commercial.accounts SET stripe_customer_id=$2 WHERE id=$1', [accountId, customer]);
}

async function portalCustomer(db, accountId) {
    return (await db.query('SELECT stripe_customer_id FROM commercial.accounts WHERE id=$1 AND suspended_at IS NULL',
        [accountId])).rows[0]?.stripe_customer_id;
}

async function recordEvent(db, event, customer) {
    await db.query(`INSERT INTO commercial.stripe_events(id,type,object_id,customer_id) VALUES ($1,$2,$3,$4)
        ON CONFLICT(id) DO NOTHING`, [event.id, event.type, event.data.object.id, customer]);
}

async function persistPaidPeriod(client, period, plan) {
    await meterLock(client);
    // Unique service-period and invoice identities make replays harmless; an
    // existing allowance's used/reserved credits are never reset.
    await client.query(`INSERT INTO commercial.periods(id,account_id,plan,starts_at,ends_at,allowance,key_limit,rate_limit,concurrency,invoice_id)
        VALUES ($1,$2,'business',to_timestamp($3),to_timestamp($4),$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [period.id, period.accountId, period.start, period.end, plan.credits, plan.keys, plan.rate, plan.concurrency, period.invoiceId]);
    await client.query('UPDATE commercial.accounts SET stripe_subscription_id=$2 WHERE id=$1', [period.accountId, period.subscription]);
}

async function markCustomerChecked(client, accountId) {
    await client.query('UPDATE commercial.accounts SET billing_checked_at=now() WHERE id=$1', [accountId]);
}

async function claimEvent(client) {
    return (await client.query(`SELECT * FROM commercial.stripe_events
        WHERE processed_at IS NULL AND available_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
}

async function lockCustomerAccount(client, customerId) {
    // NO KEY UPDATE allows account FK checks by a meter transaction and avoids
    // inverting the existing meter/account lock order.
    return (await client.query('SELECT * FROM commercial.accounts WHERE stripe_customer_id=$1 FOR NO KEY UPDATE', [customerId])).rows[0];
}

async function claimDueAccount(client) {
    return (await client.query(`SELECT * FROM commercial.accounts WHERE stripe_customer_id IS NOT NULL
        AND billing_checked_at<now()-interval '10 minutes' ORDER BY billing_checked_at FOR NO KEY UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
}

async function completeEvent(client, eventId) {
    await client.query('UPDATE commercial.stripe_events SET processed_at=now(),failure=false WHERE id=$1', [eventId]);
}

async function deferEvent(client, eventId) {
    await client.query(`UPDATE commercial.stripe_events SET attempts=attempts+1,failure=true,
        available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::int) WHERE id=$1`, [eventId]);
}

module.exports = { lockAccount, storeCustomer, portalCustomer, recordEvent, persistPaidPeriod,
    markCustomerChecked, claimEvent, lockCustomerAccount, claimDueAccount, completeEvent, deferEvent };
