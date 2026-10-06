const Stripe = require('stripe');
const { createHash } = require('crypto');
const pool = require('../db/pool');
const { transaction, failure, meterLock } = require('../db/commercialQueries');
const { config, PLANS } = require('./commercialConfig');

function stripeClient() {
    if (!process.env.STRIPE_SECRET_KEY) throw failure('Billing is not configured','BILLING_UNAVAILABLE',503);
    config(); // Refuse a key from another environment before making requests.
    return new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-09-30.endive',timeout:10000,maxNetworkRetries:1});
}
async function verifyEnvironment(db = pool) {
    const settings = config();
    if (!settings.enabled) return;
    await db.query('INSERT INTO commercial.environment(singleton,mode) VALUES (true,$1) ON CONFLICT DO NOTHING',[settings.mode]);
    const result = await db.query('SELECT mode FROM commercial.environment WHERE singleton');
    if (result.rows[0]?.mode !== settings.mode) throw new Error('Billing environment mismatch: use a separate database');
    if (settings.checkout) {
        const stripe = stripeClient();
        const price = await stripe.prices.retrieve(process.env.STRIPE_BUSINESS_PRICE_ID);
        if (price.livemode !== (settings.mode==='live') || !price.active || price.currency!=='cad' || price.unit_amount!==4900
            || price.recurring?.interval!=='month' || price.recurring?.interval_count!==1) throw new Error('Business price does not match the reviewed plan');
        if (process.env.STRIPE_TAX_ENABLED === 'true') {
            if (process.env.STRIPE_TAX_REGISTRATION_CONFIRMED !== 'true') throw new Error('Tax registration confirmation required');
            const [tax, registrations] = await Promise.all([stripe.tax.settings.retrieve(),stripe.tax.registrations.list({status:'active',limit:1})]);
            if (tax.status !== 'active' || !registrations.data.length) throw new Error('Stripe Tax is not ready to collect');
        }
        if (settings.mode==='live' && process.env.STRIPE_TAX_REVIEWED !== 'true') throw new Error('Live tax setup must be reviewed');
    }
}
async function ensureCustomer(accountId,user,stripe = stripeClient(),db = pool) {
    return transaction(async client => {
        const { rows } = await client.query('SELECT * FROM commercial.accounts WHERE id=$1 FOR NO KEY UPDATE',[accountId]);
        const account = rows[0];
        if (!account?.owner_id || account.suspended_at) throw failure('Account unavailable','ACCOUNT_SUSPENDED',403);
        let customer = account.stripe_customer_id;
        if (!customer) {
            const created = await stripe.customers.create({email:user.email,name:user.name,metadata:{canquery_account_id:accountId}},
                {idempotencyKey:'canquery-customer-'+accountId});
            customer = created.id;
            await client.query('UPDATE commercial.accounts SET stripe_customer_id=$2 WHERE id=$1',[accountId,customer]);
        }
        return customer;
    },db);
}
async function checkout(accountId,user,stripe = stripeClient(),db = pool) {
    const settings = config();
    if (!settings.checkout) throw failure('Checkout is not available yet','BILLING_UNAVAILABLE',503);
    // Commit the customer reference even if a later Checkout request fails.
    await ensureCustomer(accountId,user,stripe,db);
    return transaction(async client => {
        const account=(await client.query('SELECT * FROM commercial.accounts WHERE id=$1 FOR NO KEY UPDATE',[accountId])).rows[0];
        if (!account?.owner_id || account.suspended_at) throw failure('Account unavailable','ACCOUNT_SUSPENDED',403);
        const customer=account.stripe_customer_id;
        const subscriptions = await stripe.subscriptions.list({customer,status:'all',limit:100});
        if (subscriptions.has_more) throw failure('Contact support to review this billing customer','BILLING_REVIEW_REQUIRED',409);
        if (subscriptions.data.some(s=>!['canceled','incomplete_expired'].includes(s.status))) {
            throw failure('Manage your existing subscription in the billing portal','SUBSCRIPTION_EXISTS',409);
        }
        const sessions = await stripe.checkout.sessions.list({customer,limit:100});
        if (sessions.has_more) {
            // A customer with an unusually large history needs a complete review
            // before creating another subscription; never assume the first page is all history.
            throw failure('Contact support to review this billing customer','BILLING_REVIEW_REQUIRED',409);
        }
        const open = sessions.data.find(s=>s.status==='open' && s.metadata?.canquery_account_id===accountId);
        if (open) return {url:open.url};
        const suffix = createHash('sha256').update(accountId).digest('hex').slice(0,8).replace(/[0-9]/g,n=>String.fromCharCode(97+Number(n)));
        const session = await stripe.checkout.sessions.create({
            mode:'subscription',customer,client_reference_id:accountId,
            managed_payments:{enabled:false},
            metadata:{canquery_account_id:accountId},
            line_items:[{price:process.env.STRIPE_BUSINESS_PRICE_ID,quantity:1}],
            subscription_data:{billing_mode:{type:'flexible'},metadata:{canquery_account_id:accountId}},
            integration_identifier:'canquery_business_'+suffix,
            success_url:settings.origin+'/account?checkout=returned',cancel_url:settings.origin+'/pricing',
            ...(process.env.STRIPE_TAX_ENABLED==='true' ? {automatic_tax:{enabled:true},customer_update:{address:'auto'}} : {})
        },{idempotencyKey:`canquery-checkout-${accountId}-${sessions.data[0]?.id || 'initial'}`});
        return {url:session.url};
    },db);
}
async function portal(accountId,stripe = stripeClient(),db = pool) {
    const { rows } = await db.query('SELECT stripe_customer_id FROM commercial.accounts WHERE id=$1 AND suspended_at IS NULL',[accountId]);
    if (!rows[0]?.stripe_customer_id) throw failure('No billing customer exists yet','NO_BILLING_CUSTOMER',409);
    const session = await stripe.billingPortal.sessions.create({customer:rows[0].stripe_customer_id,
        ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID ? {configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID} : {}),
        return_url:config().origin+'/account'});
    return {url:session.url};
}
const EVENTS = new Set(['invoice.paid','invoice.payment_failed','customer.subscription.created',
    'customer.subscription.updated','customer.subscription.deleted','checkout.session.completed','checkout.session.async_payment_succeeded']);
async function receiveWebhook(body,signature,stripe = stripeClient(),db = pool) {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw failure('Webhook is not configured','BILLING_UNAVAILABLE',503);
    let event;
    try { event = stripe.webhooks.constructEvent(body,signature,process.env.STRIPE_WEBHOOK_SECRET); }
    catch { throw failure('Invalid webhook signature','INVALID_WEBHOOK',400); }
    if (event.livemode !== (config().mode==='live')) throw failure('Webhook environment mismatch','INVALID_WEBHOOK',400);
    if (!EVENTS.has(event.type)) return;
    const object = event.data.object;
    const customer = typeof object.customer==='string' ? object.customer : object.customer?.id;
    if (!customer || typeof object.id !== 'string') throw failure('Invalid billing event','INVALID_WEBHOOK',400);
    await db.query(`INSERT INTO commercial.stripe_events(id,type,object_id,customer_id) VALUES ($1,$2,$3,$4)
        ON CONFLICT(id) DO NOTHING`,[event.id,event.type,object.id,customer]);
}
async function applyPaidInvoice(client,account,invoice,lines) {
    if (invoice.status!=='paid' || invoice.customer!==account.stripe_customer_id || invoice.currency!=='cad'
        || invoice.livemode!==(config().mode==='live') || !['subscription_create','subscription_cycle'].includes(invoice.billing_reason)) return false;
    const matching = lines.filter(l=>(l.pricing?.price_details?.price || l.price?.id)===process.env.STRIPE_BUSINESS_PRICE_ID
        && l.quantity===1 && !l.parent?.subscription_item_details?.proration && !l.proration);
    if (matching.length!==1) return false;
    const line = matching[0];
    const start = line.period?.start;
    const end = line.period?.end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end<=start || end-start>32*86400) throw new Error('Invalid billing period');
    const subscription = invoice.parent?.subscription_details?.subscription || invoice.subscription;
    if (typeof subscription!=='string') throw new Error('Invoice subscription is missing');
    await meterLock(client);
    // A recurring service period is unique even if Stripe produces more than
    // one invoice for it. Never reset already consumed credits on a replay.
    const id = `business:${account.id}:${subscription}:${start}:${end}`;
    await client.query(`INSERT INTO commercial.periods(id,account_id,plan,starts_at,ends_at,allowance,key_limit,rate_limit,concurrency,invoice_id)
        VALUES ($1,$2,'business',to_timestamp($3),to_timestamp($4),$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [id,account.id,start,end,PLANS.business.credits,PLANS.business.keys,PLANS.business.rate,PLANS.business.concurrency,invoice.id]);
    await client.query('UPDATE commercial.accounts SET stripe_subscription_id=$2 WHERE id=$1',[account.id,subscription]);
    return true;
}
async function reconcileCustomer(client,account,stripe,event) {
    if (!account.stripe_customer_id) return;
    const invoices = await stripe.invoices.list({customer:account.stripe_customer_id,status:'paid',limit:100});
    // Retrieve the event's invoice directly as well: intervening invoices must
    // not hide an earned period beyond the first reconciliation page.
    if (event?.type.startsWith('invoice.') && !invoices.data.some(i=>i.id===event.object_id)) {
        invoices.data.push(await stripe.invoices.retrieve(event.object_id));
    }
    const captured=[];
    for (const invoice of invoices.data) {
        let lines = invoice.lines?.data || [];
        if (invoice.lines?.has_more) {
            lines = await stripe.invoices.listLineItems(invoice.id,{limit:100}).autoPagingToArray({limit:1000});
        }
        captured.push({invoice,lines});
    }
    // Fetch all remote pages before acquiring the short global meter lock.
    for (const {invoice,lines} of captured) await applyPaidInvoice(client,account,invoice,lines);
    await client.query('UPDATE commercial.accounts SET billing_checked_at=now() WHERE id=$1',[account.id]);
}
async function processBilling(db = pool,stripe) {
    if (!stripe && !process.env.STRIPE_SECRET_KEY) return;
    stripe ||= stripeClient();
    await transaction(async client => {
        const pending = await client.query(`SELECT * FROM commercial.stripe_events
            WHERE processed_at IS NULL AND available_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`);
        const event = pending.rows[0];
        if (event) {
            await client.query('SAVEPOINT billing_event');
            try {
                // NO KEY UPDATE serializes customer operations while allowing
                // a meter transaction to insert a period's account FK. A full
                // row lock would invert that transaction's meter/row order.
                const account = (await client.query('SELECT * FROM commercial.accounts WHERE stripe_customer_id=$1 FOR NO KEY UPDATE',[event.customer_id])).rows[0];
                if (account) await reconcileCustomer(client,account,stripe,event);
                await client.query('UPDATE commercial.stripe_events SET processed_at=now(),failure=false WHERE id=$1',[event.id]);
            } catch {
                await client.query('ROLLBACK TO SAVEPOINT billing_event');
                await client.query(`UPDATE commercial.stripe_events SET attempts=attempts+1,failure=true,
                    available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::int) WHERE id=$1`,[event.id]);
            }
        } else {
            const account = (await client.query(`SELECT * FROM commercial.accounts WHERE stripe_customer_id IS NOT NULL
                AND billing_checked_at<now()-interval '10 minutes' ORDER BY billing_checked_at FOR NO KEY UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
            if (account) await reconcileCustomer(client,account,stripe);
        }
    },db);
}
module.exports = { stripeClient, verifyEnvironment, ensureCustomer, checkout, portal, receiveWebhook, applyPaidInvoice, processBilling };
