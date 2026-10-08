const { createHash } = require('crypto');
const pool = require('../db/pool');
const { transaction, failure } = require('../db/commercialQueries');
const { config, PLANS, BUSINESS_PRICE } = require('./commercialConfig');

const { stripeClient, capturePaidInvoices } = require('./billingProvider');
const { interpretPaidInvoice, matchesBusinessPrice, matchesCheckoutSession } = require('./billingPolicy');
const billingDb = require('../db/billingQueries');

async function verifyEnvironment(db = pool) {
    const settings = config();
    if (!settings.enabled) return;
    await db.query('INSERT INTO commercial.environment(singleton,mode) VALUES (true,$1) ON CONFLICT DO NOTHING',[settings.mode]);
    const result = await db.query('SELECT mode FROM commercial.environment WHERE singleton');
    if (result.rows[0]?.mode !== settings.mode) throw new Error('Billing environment mismatch: use a separate database');
    if (settings.checkout) {
        const stripe = stripeClient();
        const price = await stripe.prices.retrieve(process.env.STRIPE_BUSINESS_PRICE_ID);
        if (!matchesBusinessPrice(price, BUSINESS_PRICE, settings.mode)) throw new Error('Business price does not match the reviewed plan');
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
        const account = await billingDb.lockAccount(client, accountId);
        if (!account?.owner_id || account.suspended_at) throw failure('Account unavailable','ACCOUNT_SUSPENDED',403);
        let customer = account.stripe_customer_id;
        if (!customer) {
            const created = await stripe.customers.create({email:user.email,name:user.name,metadata:{canquery_account_id:accountId}},
                {idempotencyKey:'canquery-customer-'+accountId});
            customer = created.id;
            await billingDb.storeCustomer(client, accountId, customer);
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
        const account = await billingDb.lockAccount(client, accountId);
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
        const open = sessions.data.filter(s=>s.status==='open' && s.metadata?.canquery_account_id===accountId);
        if (open.length) {
            // An already-open hosted session keeps its original price. Never
            // redirect a customer to an older offer after configuration changes,
            // or create a competing session while that checkout can still pay.
            if (open.length!==1) throw failure('Contact support to review existing checkout sessions','BILLING_REVIEW_REQUIRED',409);
            const existing = open[0];
            const lines = await stripe.checkout.sessions.listLineItems(existing.id,{limit:2});
            if (!matchesCheckoutSession(existing, lines, { mode: settings.mode,
                priceId: process.env.STRIPE_BUSINESS_PRICE_ID, taxEnabled: process.env.STRIPE_TAX_ENABLED === 'true' })) {
                throw failure('Existing checkout no longer matches the current plan; contact support','BILLING_REVIEW_REQUIRED',409);
            }
            return {url:existing.url};
        }
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
        },{idempotencyKey:`canquery-checkout-${accountId}-${process.env.STRIPE_BUSINESS_PRICE_ID}-${sessions.data[0]?.id || 'initial'}`});
        return {url:session.url};
    },db);
}
async function portal(accountId,stripe = stripeClient(),db = pool) {
    const customer = await billingDb.portalCustomer(db, accountId);
    if (!customer) throw failure('No billing customer exists yet','NO_BILLING_CUSTOMER',409);
    const session = await stripe.billingPortal.sessions.create({customer,
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
    await billingDb.recordEvent(db, event, customer);
}
async function applyPaidInvoice(client, account, invoice, lines) {
    const period = interpretPaidInvoice(account, invoice, lines, {
        mode: config().mode, priceId: process.env.STRIPE_BUSINESS_PRICE_ID
    });
    if (!period) return false;
    await billingDb.persistPaidPeriod(client, period, PLANS.business);
    return true;
}

async function reconcileCustomer(client, account, stripe, event) {
    if (!account.stripe_customer_id) return;
    const captured = await capturePaidInvoices(stripe, account.stripe_customer_id, event);
    for (const { invoice, lines } of captured) await applyPaidInvoice(client, account, invoice, lines);
    await billingDb.markCustomerChecked(client, account.id);
}

async function processBilling(db = pool, stripe) {
    if (!stripe && !process.env.STRIPE_SECRET_KEY) return;
    stripe ||= stripeClient();
    // Preserve event/customer transaction ownership across provider calls.
    // Moving network I/O outside this transaction needs a separate durable
    // claim/idempotency design. Only the global meter lock remains short-lived.
    await transaction(async client => {
        const event = await billingDb.claimEvent(client);
        if (event) {
            await client.query('SAVEPOINT billing_event');
            try {
                const account = await billingDb.lockCustomerAccount(client, event.customer_id);
                if (account) await reconcileCustomer(client, account, stripe, event);
                await billingDb.completeEvent(client, event.id);
            } catch {
                await client.query('ROLLBACK TO SAVEPOINT billing_event');
                await billingDb.deferEvent(client, event.id);
            }
        } else {
            const account = await billingDb.claimDueAccount(client);
            if (account) await reconcileCustomer(client, account, stripe);
        }
    }, db);
}
module.exports = { stripeClient, verifyEnvironment, ensureCustomer, checkout, portal, receiveWebhook, applyPaidInvoice, processBilling };
