// Run only against the same explicitly disposable database as the spatial tests.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const supertest = require('supertest');
const enabled = process.env.COMMERCIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL || enabled !== process.env.SPATIAL_TEST_DATABASE_URL) {
    test('commercial integration requires three matching disposable database URLs', {skip:true},()=>{});
} else {
    process.env.COMMERCIAL_API_ENABLED='true';
    process.env.BETTER_AUTH_SECRET=randomUUID()+randomUUID();
    process.env.STRIPE_MODE='sandbox';
    process.env.SITE_URL='http://localhost:3100';
    process.env.STRIPE_BUSINESS_PRICE_ID='price_fixture_business';
    delete process.env.STRIPE_SECRET_KEY;
    const db = require('../db/pool');
    const q = require('../db/commercialQueries');
    const billing = require('../services/billingService');
    const admin = require('../services/commercialAdmin');
    const { decrypt, deliverMail, enqueueAccountMail } = require('../services/accountMail');
    const { getAuth } = require('../services/authRuntime');
    const app = require('../app');
    const ownerId='commercial-test-'+randomUUID();
    let account;
    let key;
    let identity;
    const ids=[];
    const resources=[];
    before(async()=>{
        await billing.verifyEnvironment();
        await db.query(`INSERT INTO canquery_auth."user"(id,name,email,"emailVerified","termsVersion","termsAcceptedAt") VALUES ($1,$1,$2,true,'2026-10-06',now())`,[ownerId,ownerId+'@example.test']);
        account=await q.accountForUser(ownerId);
        ids.push(account.id);
        key=await q.createKey(account.id,'Integration key');
        identity=await q.authenticate(key.secret);
    });
    after(async()=>{
        for (const id of resources) {
            await db.query('DELETE FROM ingest_jobs WHERE resource_id=$1',[id]);
            await db.query('DELETE FROM resources WHERE id=$1',[id]);
            await db.query('DELETE FROM datasets WHERE id=$1',[id]);
        }
        await db.query("DELETE FROM commercial.stripe_events WHERE id LIKE 'evt_fixture_%'");
        await db.query('DELETE FROM commercial.mail_outbox');
        for (const id of ids) {
            for (const table of ['requests','rate_windows','usage_daily','periods','api_keys']) await db.query(`DELETE FROM commercial.${table} WHERE account_id=$1`,[id]);
            await db.query('DELETE FROM commercial.accounts WHERE id=$1',[id]);
        }
        await db.query('DELETE FROM canquery_auth."user" WHERE id=$1 OR email LIKE $2 OR id LIKE $3',[ownerId,'commercial-auth-%@example.test',ownerId+'-extra-%']);
        await (await getAuth()).close();
        await db.end();
    });
    test('keys are hashed, constrained by plan, immediately revocable and owner scoped',async()=>{
        assert.equal((await db.query('SELECT digest FROM commercial.api_keys WHERE id=$1',[key.id])).rows[0].digest.includes(key.secret),false);
        await assert.rejects(q.createKey(account.id,'second'),{publicCode:'KEY_LIMIT'});
        await assert.rejects(q.revokeKey(randomUUID(),key.id),{statusCode:404});
        assert.equal((await q.authenticate(key.secret)).account_id,account.id);
        await assert.rejects(q.authenticate('cq_invalid'),{statusCode:401});
    });
    test('mail enqueue on another pool connection does not block an uncommitted auth signup',async()=>{
        const user={id:ownerId+'-extra-pending',email:'commercial-auth-'+randomUUID()+'@example.test'};
        const client=await db.connect();
        try {
            await client.query('BEGIN');
            await client.query(`INSERT INTO canquery_auth."user"(id,name,email,"emailVerified","termsVersion","termsAcceptedAt") VALUES ($1,$1,$2,false,'2026-10-06',now())`,[user.id,user.email]);
            let timer;
            try { await Promise.race([enqueueAccountMail({user,url:'http://localhost:3100/fixture'},'verify'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Email enqueue blocked the auth transaction')),1500);})]); }
            finally { clearTimeout(timer); }
            assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.mail_outbox WHERE user_id=$1',[user.id])).rows[0].n,1);
        } finally {
            await client.query('ROLLBACK');client.release();
            await db.query('DELETE FROM commercial.mail_outbox WHERE user_id=$1',[user.id]);
        }
    });
    test('billing account locks allow the first free period without a meter lock inversion',async()=>{
        const user=ownerId+'-extra-lock';
        await db.query(`INSERT INTO canquery_auth."user"(id,name,email,"emailVerified","termsVersion","termsAcceptedAt") VALUES ($1,$1,$2,true,'2026-10-06',now())`,[user,user+'@example.test']);
        const extra=await q.accountForUser(user);ids.push(extra.id);
        const client=await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT id FROM commercial.accounts WHERE id=$1 FOR NO KEY UPDATE',[extra.id]);
            await q.transaction(async c=>{await c.query("SET LOCAL lock_timeout='1s'");await q.meterLock(c);await q.currentPeriod(c,extra.id);});
            await q.meterLock(client);
        } finally {await client.query('ROLLBACK');client.release();}
    });
    test('simultaneous requests cannot spend the final credit twice',async()=>{
        const period=await q.transaction(c=>q.currentPeriod(c,account.id));
        await db.query('UPDATE commercial.periods SET used=999 WHERE id=$1',[period.id]);
        const results=await Promise.allSettled(Array.from({length:8},()=>q.reserve(identity,{name:'metadata',cost:1})));
        const accepted=results.filter(r=>r.status==='fulfilled');
        assert.equal(accepted.length,1);
        assert.equal(results.filter(r=>r.status==='rejected' && r.reason.publicCode==='QUOTA_EXCEEDED').length,7);
        await q.settle(accepted[0].value.id,false);
        assert.equal((await q.dashboard(account.id)).remaining,1);
        await db.query('UPDATE commercial.periods SET used=0 WHERE id=$1',[period.id]);
    });
    test('settlement, abort refunds and expired reservation recovery are idempotent',async()=>{
        const r=await q.reserve(identity,{name:'export',cost:25,expensive:true});
        await assert.rejects(q.reserve(identity,{name:'export',cost:25,expensive:true}),{publicCode:'CONCURRENCY_LIMIT'});
        await q.settle(r.id,true); await q.settle(r.id,true);
        assert.equal((await q.dashboard(account.id)).used,25);
        await q.abortRequest(r.id);await q.abortRequest(r.id);
        assert.equal((await q.dashboard(account.id)).used,0);
        const stale=await q.reserve(identity,{name:'profile',cost:10,expensive:true});
        await db.query("UPDATE commercial.requests SET expires_at=now()-interval '1 second' WHERE id=$1",[stale.id]);
        await q.maintenance();
        assert.equal((await q.dashboard(account.id)).reserved,0);
    });
    test('preparation charging commits with admission and rolls back with a failed transaction',async()=>{
        const r=await q.reserve(identity,{name:'preparation',cost:0});
        await assert.rejects(q.transaction(async c=>{await q.chargePreparation(c,r,123);throw Error('failed admission');}));
        assert.equal((await q.dashboard(account.id)).used,0);
        await q.transaction(c=>q.chargePreparation(c,r,123));
        await q.abortRequest(r.id);
        assert.equal((await q.dashboard(account.id)).used,100);
    });
    test('only a paid matching invoice creates a period; retries do not reset its usage',async()=>{
        const customer='cus_fixture_'+account.id;
        await db.query('UPDATE commercial.accounts SET stripe_customer_id=$2 WHERE id=$1',[account.id,customer]);
        account.stripe_customer_id=customer;
        const start=Math.floor(Date.now()/1000)-60;
        const invoice={id:'in_fixture_'+account.id,customer,currency:'cad',livemode:false,status:'open',billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_fixture'}}};
        const lines=[{quantity:1,period:{start,end:start+30*86400},pricing:{price_details:{price:'price_fixture_business'}}}];
        assert.equal(await q.transaction(c=>billing.applyPaidInvoice(c,account,invoice,lines)),false);
        invoice.status='paid';
        assert.equal(await q.transaction(c=>billing.applyPaidInvoice(c,account,invoice,lines)),true);
        const r=await q.reserve(identity,{name:'metadata',cost:1}); await q.settle(r.id,true);
        await q.transaction(c=>billing.applyPaidInvoice(c,account,invoice,lines));
        assert.equal((await q.dashboard(account.id)).used,1);
        assert.equal((await q.dashboard(account.id)).plan,'business');
        await db.query("UPDATE commercial.periods SET revoked_at=now() WHERE account_id=$1 AND plan='business'",[account.id]);
        assert.equal((await q.dashboard(account.id)).used,100);
    });
    test('checkout reuses open sessions, prevents duplicate subscriptions and preserves environment',async()=>{
        process.env.STRIPE_SECRET_KEY='sk_test_fixture';
        let creates=0;
        const stripe={subscriptions:{list:async()=>({data:[]})},checkout:{sessions:{list:async()=>({data:[]}),create:async input=>{
            creates++;assert.equal(input.mode,'subscription');assert.equal(input.managed_payments.enabled,false);
            assert.equal(input.subscription_data.billing_mode.type,'flexible');
            assert.equal(input.line_items[0].price,'price_fixture_business');
            assert.equal(input.customer,account.stripe_customer_id);
            return {url:'https://checkout.stripe.com/fixture'};
        }}}};
        assert.equal((await billing.checkout(account.id,{email:'fixture@example.test'},stripe)).url,'https://checkout.stripe.com/fixture');
        stripe.checkout.sessions.list=async()=>({data:[{id:'cs_existing',status:'open',url:'https://checkout.stripe.com/existing',metadata:{canquery_account_id:account.id}}]});
        assert.equal((await billing.checkout(account.id,{},stripe)).url,'https://checkout.stripe.com/existing');assert.equal(creates,1);
        stripe.subscriptions.list=async()=>({data:[{status:'past_due'}]});
        await assert.rejects(billing.checkout(account.id,{},stripe),{publicCode:'SUBSCRIPTION_EXISTS'});
        process.env.STRIPE_MODE='live';
        assert.throws(()=>require('../services/commercialConfig').config(),/credential/);
        process.env.STRIPE_MODE='sandbox';delete process.env.STRIPE_SECRET_KEY;
    });
    test('enterprise grants require paid owned invoices and never reset existing usage',async()=>{
        const input={invoice:'in_enterprise'+account.id.replaceAll('-',''),credits:1234,keys:3,rate:100,concurrency:2,start:new Date(Date.now()-10000).toISOString(),end:new Date(Date.now()+86400000).toISOString()};
        let invoice={status:'open',livemode:false,currency:'cad',customer:account.stripe_customer_id};
        const stripe={invoices:{retrieve:async()=>invoice}};
        await assert.rejects(admin.grant(account.id,input,stripe),/not paid/);
        invoice={...invoice,status:'paid',customer:'cus_unrelated'};
        await assert.rejects(admin.grant(account.id,input,stripe),/does not match/);
        invoice.customer=account.stripe_customer_id;
        const grant=await admin.grant(account.id,input,stripe);
        const reservation=await q.reserve(identity,{name:'metadata',cost:1});await q.settle(reservation.id,true);
        await admin.grant(account.id,input,stripe);
        assert.equal((await q.dashboard(account.id)).used,1);
        await assert.rejects(admin.grant(account.id,{...input,credits:2000},stripe),/different grant/);
        await db.query('UPDATE commercial.periods SET revoked_at=now() WHERE id=$1',[grant.id]);
        assert.equal((await q.dashboard(account.id)).plan,'free');
    });
    test('HTTP authentication, public browser API, private caching and sunset',async()=>{
        const privateResult=await supertest(app).get('/api/v1/sources').set('Authorization','Bearer '+key.secret);
        assert.equal(privateResult.status,200);
        assert.equal(privateResult.headers['cache-control'],'private, no-store');
        assert.ok(Number(privateResult.headers['x-canquery-credits-remaining'])>=0);
        const wrong=await supertest(app).get('/api/v1/sources').set('Authorization','Bearer invalid');
        assert.equal(wrong.status,401);
        process.env.API_KEY_REQUIRED_AT='2020-01-01T00:00:00Z';
        assert.equal((await supertest(app).get('/api/v1/sources')).status,401);
        assert.equal((await supertest(app).get('/web-api/v1/sources')).status,200);
        delete process.env.API_KEY_REQUIRED_AT;
    });
    test('real Better Auth signup, verification, session and CSRF protection',async()=>{
        const email='commercial-auth-'+randomUUID()+'@example.test';
        const agent=supertest.agent(app);
        const headers={Origin:'http://localhost:3100','Accept-Language':'fr'};
        const body={name:'Sandbox owner',email,password:'disposable-password-long-enough',termsVersion:'2026-10-06',callbackURL:'http://localhost:3100/account'};
        assert.equal((await agent.post('/api/auth/sign-up/email').set(headers).send(body)).status,200);
        assert.equal((await agent.post('/api/auth/sign-in/email').set(headers).send(body)).status,403);
        const mail=(await db.query('SELECT payload FROM commercial.mail_outbox ORDER BY created_at LIMIT 1')).rows[0];
        const message=decrypt(mail.payload);
        assert.match(message.subject,/Confirmez/);
        const link=new URL(message.text.split('\n').find(s=>s.startsWith('http')));
        assert.equal((await agent.get(link.pathname+link.search)).status,302);
        assert.equal((await agent.post('/api/auth/sign-in/email').set(headers).send(body)).status,200);
        const dashboard=await agent.get('/api/account');
        assert.equal(dashboard.status,200);
        const owner=(await db.query('SELECT id FROM canquery_auth."user" WHERE email=$1',[email])).rows[0];
        const created=await q.accountForUser(owner.id);ids.push(created.id);
        assert.equal((await agent.post('/api/account/keys').send({name:'CSRF'})).status,403);
        assert.equal((await agent.post('/api/account/keys').set(headers).send({name:'Owner key'})).status,201);
        assert.equal((await supertest(app).get('/api/account')).status,401);
        const accepted=(await db.query('SELECT "termsVersion","termsAcceptedAt" FROM canquery_auth."user" WHERE id=$1',[owner.id])).rows[0];
        assert.equal(accepted.termsVersion,'2026-10-06');
        assert.ok(accepted.termsAcceptedAt);
        assert.equal((await agent.post('/api/auth/request-password-reset').set(headers).send({email,redirectTo:'http://localhost:3100/reset-password'})).status,200);
        const resetMail=(await db.query('SELECT payload FROM commercial.mail_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[owner.id])).rows[0];
        const resetLink=new URL(decrypt(resetMail.payload).text.split('\n').find(s=>s.startsWith('http')));
        const callback=await agent.get(resetLink.pathname+resetLink.search);
        assert.equal(callback.status,302);
        const token=new URL(callback.headers.location).searchParams.get('token');
        assert.ok(token);
        const password='new-disposable-password-long-enough';
        assert.equal((await agent.post('/api/auth/reset-password').set(headers).send({token,newPassword:password})).status,200);
        assert.equal((await agent.get('/api/account')).status,401);
        assert.equal((await agent.post('/api/auth/reset-password').set(headers).send({token,newPassword:password})).status,400);
        assert.equal((await agent.post('/api/auth/sign-in/email').set(headers).send({...body,password})).status,200);
        assert.equal((await agent.post('/api/auth/sign-out').set(headers).send({})).status,200);
        assert.equal((await agent.get('/api/account')).status,401);
    });
    test('terms acceptance is checked by the server and external callbacks are rejected',async()=>{
        const body={name:'Rejected owner',email:'commercial-auth-'+randomUUID()+'@example.test',password:'long-enough-password-123'};
        const missing=await supertest(app).post('/api/auth/sign-up/email').set('Origin','http://localhost:3100').send(body);
        assert.equal(missing.status,400);
        const foreign=await supertest(app).post('/api/auth/sign-up/email').set('Origin','http://localhost:3100')
            .send({...body,termsVersion:'2026-10-06',callbackURL:'https://example.invalid/capture'});
        assert.equal(foreign.status,403);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM canquery_auth."user" WHERE email=$1',[body.email])).rows[0].n,0);
    });
    test('encrypted email retries retain their job and successful delivery removes it',async()=>{
        const before=(await db.query('SELECT count(*)::int AS n FROM commercial.mail_outbox')).rows[0].n;
        assert.ok(before>0);
        await deliverMail(db,{sendMail:async()=>{throw Error('temporary SMTP failure');}});
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.mail_outbox')).rows[0].n,before);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.mail_outbox WHERE attempts=1')).rows[0].n,1);
        await db.query('UPDATE commercial.mail_outbox SET available_at=now()');
        let delivered;
        await deliverMail(db,{sendMail:async mail=>{delivered=mail;}});
        assert.equal(delivered.envelope.from,'accounts@canquery.com');
        assert.equal(delivered.replyTo,'support@canquery.com');
        assert.match(delivered.envelope.to,/@example.test$/);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.mail_outbox')).rows[0].n,before-1);
    });
    test('signed webhook duplicates persist one identity and retries do not grant unpaid access',async()=>{
        const Stripe=require('stripe');
        const stripe=new Stripe('sk_test_fixture');
        process.env.STRIPE_WEBHOOK_SECRET='whsec_disposable_fixture';
        const event={id:'evt_fixture_'+randomUUID(),type:'invoice.paid',livemode:false,data:{object:{id:'in_fixture_event',customer:account.stripe_customer_id}}};
        const payload=JSON.stringify(event);
        const signature=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
        await assert.rejects(billing.receiveWebhook(Buffer.from(payload),'invalid',stripe),{statusCode:400});
        await billing.receiveWebhook(Buffer.from(payload),signature,stripe);
        await billing.receiveWebhook(Buffer.from(payload),signature,stripe);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.stripe_events WHERE id=$1',[event.id])).rows[0].n,1);
        await billing.processBilling(db,{invoices:{list:async()=>{throw Error('upstream unavailable');}}});
        const failed=(await db.query('SELECT * FROM commercial.stripe_events WHERE id=$1',[event.id])).rows[0];
        assert.equal(failed.attempts,1);assert.equal(failed.failure,true);assert.equal(failed.processed_at,null);
        assert.ok(failed.available_at>failed.received_at);
        await db.query('UPDATE commercial.stripe_events SET available_at=now() WHERE id=$1',[event.id]);
        await billing.processBilling(db,{invoices:{list:async()=>({data:[]}),retrieve:async()=>({id:'in_fixture_event',status:'open'})}});
        assert.ok((await db.query('SELECT processed_at FROM commercial.stripe_events WHERE id=$1',[event.id])).rows[0].processed_at);
        assert.equal((await q.dashboard(account.id)).plan,'free');
        const wrong=JSON.stringify({...event,id:'evt_fixture_wrong',livemode:true});
        await assert.rejects(billing.receiveWebhook(Buffer.from(wrong),stripe.webhooks.generateTestHeaderString({payload:wrong,secret:process.env.STRIPE_WEBHOOK_SECRET}),stripe),{statusCode:400});
        delete process.env.STRIPE_WEBHOOK_SECRET;
    });
    test('authentication limits use durable opaque buckets and cover unknown email requests',async()=>{
        for(let i=0;i<5;i++) {
            await supertest(app).post('/api/auth/request-password-reset').set('Origin','http://localhost:3100').send({email:'absent@example.test'});
        }
        const limited=await supertest(app).post('/api/auth/request-password-reset').set('Origin','http://localhost:3100').send({email:'absent@example.test'});
        assert.equal(limited.status,429);assert.ok(Number(limited.headers['retry-after'])>0);
        const {rows}=await db.query('SELECT key FROM canquery_auth."rateLimit"');
        assert.ok(rows.length>0);
        assert.ok(rows.every(r=>/^[a-f0-9]{64}:/.test(r.key)));
        assert.equal((await supertest(app).get('/api/auth/delete-user')).status,404);
    });
    test('HTTP preparation charges exactly one new job and rolls back admission when quota is insufficient',async()=>{
        const seed=async()=>{
            const id='commercial-resource-'+randomUUID();resources.push(id);
            await db.query('INSERT INTO datasets(id,name) VALUES ($1,$1)',[id]);
            await db.query("INSERT INTO resources(id,dataset_id,format,url) VALUES ($1,$1,'CSV','https://example.org/fixture.csv')",[id]);return id;
        };
        const id=await seed();const before=(await q.dashboard(account.id)).used;
        const results=await Promise.all(Array.from({length:3},()=>supertest(app).post('/api/v1/resources/'+id+'/prepare').set('Authorization','Bearer '+key.secret)));
        assert.ok(results.every(r=>r.status===202));
        assert.equal(new Set(results.map(r=>r.body.data.id)).size,1);
        assert.equal((await q.dashboard(account.id)).used,before+100);
        assert.equal((await supertest(app).post('/api/v1/resources/'+id+'/ingest').set('Authorization','Bearer '+key.secret)).status,202);
        assert.equal((await q.dashboard(account.id)).used,before+100);
        const period=await q.transaction(c=>q.currentPeriod(c,account.id));
        await db.query('UPDATE commercial.periods SET used=999 WHERE id=$1',[period.id]);
        const rejected=await seed();
        assert.equal((await supertest(app).post('/api/v1/resources/'+rejected+'/prepare').set('Authorization','Bearer '+key.secret)).status,429);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM ingest_jobs WHERE resource_id=$1',[rejected])).rows[0].n,0);
        await db.query('UPDATE commercial.periods SET used=$2 WHERE id=$1',[period.id,before+100]);
    });
    test('global expensive concurrency is bounded across separate accounts',async()=>{
        const identities=[];
        for(let i=0;i<5;i++) {
            const user=ownerId+'-extra-'+i;
            await db.query(`INSERT INTO canquery_auth."user"(id,name,email,"emailVerified","termsVersion","termsAcceptedAt") VALUES ($1,$1,$2,true,'2026-10-06',now())`,[user,user+'@example.test']);
            const extra=await q.accountForUser(user);ids.push(extra.id);
            const extraKey=await q.createKey(extra.id,'Capacity fixture');identities.push(await q.authenticate(extraKey.secret));
        }
        const reservations=await Promise.all(identities.slice(0,4).map(i=>q.reserve(i,{name:'profile',cost:10,expensive:true})));
        await assert.rejects(q.reserve(identities[4],{name:'profile',cost:10,expensive:true}),{publicCode:'CONCURRENCY_LIMIT'});
        await Promise.all(reservations.map(r=>q.settle(r.id,false)));
        const recovered=await q.reserve(identities[4],{name:'profile',cost:10,expensive:true});await q.settle(recovered.id,false);
    });
    test('deletion is retryable on Stripe failure and removes credentials only after billing is cancelled',async()=>{
        const calls=[];
        const stripe={checkout:{sessions:{list:async function*(){yield{id:'cs_delete_fixture'};},expire:async id=>calls.push(id)}},
            subscriptions:{list:async function*(){yield{id:'sub_delete_fixture',status:'active'};},cancel:async()=>{throw Error('temporary Stripe failure');}}};
        await assert.rejects(admin.deleteAccount(account.id,stripe),/temporary Stripe/);
        assert.ok((await admin.inspect(account.id)).account.owner_id);
        await assert.rejects(q.authenticate(key.secret),{statusCode:401});
        stripe.subscriptions.cancel=async id=>calls.push(id);
        const result=await admin.deleteAccount(account.id,stripe);assert.equal(result.deleted,true);
        assert.ok(calls.includes('sub_delete_fixture'));
        assert.equal((await admin.inspect(account.id)).account.owner_id,null);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM canquery_auth."user" WHERE id=$1',[ownerId])).rows[0].n,0);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.api_keys WHERE account_id=$1 AND revoked_at IS NULL',[account.id])).rows[0].n,0);
        assert.equal((await admin.deleteAccount(account.id,stripe)).deleted,true);
    });
}
