// Accounting invariants require transactions and real PostgreSQL locks.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const enabled = process.env.COMMERCIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL || enabled !== process.env.SPATIAL_TEST_DATABASE_URL) {
    test('preparation accounting requires three matching disposable database URLs', {skip:true},()=>{});
} else {
    process.env.COMMERCIAL_API_ENABLED='true';
    process.env.BETTER_AUTH_SECRET=randomUUID()+randomUUID();
    process.env.STRIPE_MODE='sandbox';
    process.env.SITE_URL='http://localhost:3100';
    delete process.env.STRIPE_SECRET_KEY;
    const db=require('../db/pool');
    const q=require('../db/commercialQueries');
    const accounting=require('../db/preparationAccounting');
    const worker=require('../db/ingestWorkerQueries');
    const {lockIngestResource}=require('../db/ingestResourceLock');
    const {prepareResource}=require('../services/preparationService');
    const {resourceVersion}=require('../services/resourceVersion');
    const admin=require('../services/commercialAdmin');
    const fixtures=[];
    async function fixture({charged=true,rawCredits=null,ledger=true}={}) {
        const user='preparation-accounting-'+randomUUID();
        await db.query(`INSERT INTO canquery_auth."user"(id,name,email,"emailVerified","termsVersion","termsAcceptedAt")
            VALUES ($1,$1,$2,true,'2026-10-06',now())`,[user,user+'@example.test']);
        const account=await q.accountForUser(user);
        const key=await q.createKey(account.id,'Preparation fixture');
        const identity=await q.authenticate(key.secret);
        const period=await q.transaction(c=>q.currentPeriod(c,account.id));
        const resource='preparation-fixture-'+randomUUID();
        await db.query('INSERT INTO datasets(id,name) VALUES ($1,$1)',[resource]);
        const row=(await db.query(`INSERT INTO resources(id,dataset_id,format,url)
            VALUES ($1,$1,'CSV','https://example.test/fixture.csv') RETURNING *`,[resource])).rows[0];
        const version=resourceVersion(row);
        const job=(await db.query(`INSERT INTO ingest_jobs(resource_id,preparation,source_version)
            VALUES ($1,true,$2) RETURNING *`,[resource,version])).rows[0];
        const f={user,account,key,identity,period,resource,version,job};fixtures.push(f);
        if(charged) {
            const context=await q.reserve(identity,{name:'preparation',cost:0});f.request=context.id;
            if(rawCredits===null) await q.transaction(c=>q.chargePreparation(c,context,job.id));
            else await q.transaction(async c=>{
                await q.meterLock(c);
                await c.query('UPDATE commercial.periods SET used=used+$2 WHERE id=$1',[period.id,rawCredits]);
                await c.query(`INSERT INTO commercial.requests(id,account_id,period_id,operation,credits,state,expires_at,job_id)
                    VALUES ($1,$2,$3,'preparation',$4,'charged',now(),$5)`,[context.id,account.id,period.id,rawCredits,job.id]);
                await c.query(`INSERT INTO commercial.usage_daily(account_id,day,operation,requests,credits)
                    VALUES ($1,(now() AT TIME ZONE 'UTC')::date,'preparation',1,$2)`,[account.id,rawCredits]);
                if(ledger) await c.query(`INSERT INTO commercial.preparation_charges(request_id,job_id,account_id,period_id,credits,charged_at)
                    VALUES ($1,$2,$3,$4,$5,now())`,[context.id,job.id,account.id,period.id,rawCredits]);
            });
        }
        return f;
    }
    async function running(f) {
        await db.query("UPDATE ingest_jobs SET status='running',worker_id='fixture-worker',attempts=attempts+1 WHERE id=$1",[f.job.id]);
    }
    async function terminal(f,status='failed') {
        await running(f);
        return worker.finishJob(db,f.job.id,'fixture-worker',f.resource,status,status==='failed'?'private publisher failure':null,{code:'INVALID_FILE',seconds:86400});
    }
    async function charge(f) {return (await db.query('SELECT * FROM commercial.preparation_charges WHERE job_id=$1',[f.job.id])).rows[0];}
    async function used(f) {return Number((await db.query('SELECT used FROM commercial.periods WHERE id=$1',[f.period.id])).rows[0].used);}
    async function receipt(f) {await db.query(`UPDATE ingest_jobs SET published_table_name='fixture_table',published_source_version=$2,published_at=now() WHERE id=$1`,[f.job.id,f.version]);}
    after(async()=>{
        for(const f of fixtures) {
            await db.query('DELETE FROM commercial.preparation_charges WHERE account_id=$1',[f.account.id]);
            for(const table of ['requests','rate_windows','usage_daily','periods','api_keys']) await db.query(`DELETE FROM commercial.${table} WHERE account_id=$1`,[f.account.id]);
            await db.query('DELETE FROM commercial.accounts WHERE id=$1',[f.account.id]);
            await db.query('DELETE FROM canquery_auth."user" WHERE id=$1',[f.user]);
            await db.query('DELETE FROM ingest_jobs WHERE resource_id=$1',[f.resource]);
            await db.query('DELETE FROM ingested_resources WHERE resource_id=$1',[f.resource]);
            await db.query('DELETE FROM resources WHERE id=$1',[f.resource]);
            await db.query('DELETE FROM datasets WHERE id=$1',[f.resource]);
        }
        await db.end();
    });
    test('successful preparation debits once, records success, and HTTP abort cannot refund admission',async()=>{
        const f=await fixture();await receipt(f);
        assert.equal(await terminal(f,'done'),true);
        assert.equal(await worker.finishJob(db,f.job.id,'fixture-worker',f.resource,'done',null),false);
        await q.abortRequest(f.request);
        await accounting.reconcilePreparations();
        assert.equal(await used(f),100);assert.equal((await charge(f)).outcome,'succeeded');
        assert.equal((await q.dashboard(f.account.id)).returned_credits,0);
    });
    test('Express case and trailing-slash aliases retain prices, preparation admission and failed-request refunds',async()=>{
        const express=require('express');const request=require('supertest');
        const {commercialApi}=require('../middleware/commercialApi');
        const f=await fixture({charged:false});const app=express();app.use(commercialApi);
        app.get('/resources/:id/query',(req,res)=>res.json({resource_id:req.params.id,field:req.query.group_by}));
        app.get('/resources/:id/profile',(_req,res)=>res.status(502).json({error:'fixture failure'}));
        app.get('/resources/:id/query.csv',(_req,res)=>res.status(503).json({error:'fixture failure'}));
        app.post('/resources/:id/prepare',async(req,res)=>res.status(202).json(await prepareResource(req.params.id,'fixture',db,req.commercial)));
        const call=(method,path)=>request(app)[method](path).set('Authorization','Bearer '+f.key.secret);
        const aggregate=await call('get',`/ReSoUrCeS/${f.resource}/QuErY/?group_by=PublisherField&agg=count`);
        assert.equal(aggregate.status,200);assert.deepEqual(aggregate.body,{resource_id:f.resource,field:'PublisherField'});
        assert.equal(await used(f),10);
        assert.equal((await call('get',`/resources/${f.resource}/query`)).status,200);assert.equal(await used(f),11);
        for(const [path,status] of [['PrOfIlE/',502],['QuErY.CsV/',503]]) {
            assert.equal((await call('get',`/resources/${f.resource}/${path}`)).status,status);
            assert.equal(await used(f),11);assert.equal((await q.dashboard(f.account.id)).reserved,0);
        }
        const failed=(await db.query("SELECT operation,credits,state FROM commercial.requests WHERE account_id=$1 AND state='refunded' ORDER BY credits",[f.account.id])).rows;
        assert.deepEqual(failed.map(row=>({...row,credits:Number(row.credits)})),[
            {operation:'profile',credits:10,state:'refunded'},{operation:'export',credits:25,state:'refunded'}
        ]);
        const path=`/ReSoUrCeS/${f.resource}/PrEpArE/`;
        assert.equal((await call('post',path)).status,202);assert.equal(await used(f),11);assert.equal(await charge(f),undefined);
        await db.query('DELETE FROM ingest_jobs WHERE id=$1',[f.job.id]);
        const admitted=await call('post',path);assert.equal(admitted.status,202);f.job.id=String(admitted.body.id);
        assert.equal(await used(f),111);assert.equal(Number((await charge(f)).credits),100);
        assert.equal((await call('post',path)).status,202);assert.equal(await used(f),111);
    });
    test('concurrent duplicate terminal failures reverse exactly the original debit once',async()=>{
        const f=await fixture();await running(f);
        const completed=await Promise.all(Array.from({length:6},()=>worker.finishJob(db,f.job.id,'fixture-worker',f.resource,'failed','upstream failure')));
        assert.equal(completed.filter(Boolean).length,1);
        await Promise.all(Array.from({length:4},()=>accounting.reconcilePreparations()));
        assert.equal(await used(f),0);assert.equal((await charge(f)).outcome,'refunded');
        const report=await q.dashboard(f.account.id);
        assert.equal(report.returned_credits,100);assert.equal(report.gross_used,100);
        assert.equal(report.preparation_refunds.length,1);assert.equal(report.preparation_refunds[0].credits,100);
        assert.equal(report.usage[0].credits,100);assert.equal(report.usage[0].returned_credits,100);assert.equal(report.usage[0].net_credits,0);
    });
    test('internal retries retain their charge until eventual success or final failure',async()=>{
        for(const final of ['done','failed']) {
            const f=await fixture();
            for(let attempt=0;attempt<2;attempt++) {
                await running(f);assert.equal(await worker.requeueJob(db,f.job.id,'fixture-worker','temporary',0),true);
                await accounting.reconcilePreparations();assert.equal(await used(f),100);assert.equal((await charge(f)).outcome,'pending');
            }
            if(final==='done') await receipt(f);
            await terminal(f,final);
            assert.equal(await used(f),final==='done'?100:0);
        }
    });
    test('shared and anonymous observers receive no credit while a charged Free account is refunded',async()=>{
        const payer=await fixture();const observer=await fixture({charged:false});
        const context=await q.reserve(observer.identity,{name:'preparation',cost:0});
        const joined=await prepareResource(payer.resource,'fixture-observer',db,context);
        assert.equal(String(joined.id),payer.job.id);
        assert.equal((await prepareResource(payer.resource,'anonymous-observer',db)).id,joined.id);
        assert.equal(await used(observer),0);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.preparation_charges WHERE account_id=$1',[observer.account.id])).rows[0].n,0);
        await terminal(payer);await terminal(observer);
        assert.equal(await used(payer),0);assert.equal(await used(observer),0);
        assert.equal((await q.dashboard(observer.account.id)).preparation_refunds.length,0);
    });
    test('without a verified original debit a terminal failure does not invent credits',async()=>{
        const f=await fixture({charged:false});await terminal(f);
        assert.equal(await charge(f),undefined);assert.equal(await used(f),0);
        await accounting.reconcilePreparations();assert.equal(await used(f),0);
    });
    test('interrupted terminal transaction rolls back both failure and reversal, then reconciles once',async()=>{
        const f=await fixture();
        await assert.rejects(q.transaction(async c=>{
            await lockIngestResource(c,f.resource);
            await c.query("UPDATE ingest_jobs SET status='failed' WHERE id=$1",[f.job.id]);
            await accounting.settlePreparationOn(c,f.job.id);
            throw Error('process interrupted before commit');
        }),/interrupted/);
        assert.equal(await used(f),100);assert.equal((await charge(f)).outcome,'pending');
        await db.query("UPDATE ingest_jobs SET status='failed' WHERE id=$1",[f.job.id]);
        const result=await accounting.reconcilePreparations();assert.ok(result.resolved>=1);
        assert.equal(await used(f),0);assert.equal((await charge(f)).outcome,'refunded');
    });
    test('rollover and a new paid period do not redirect a reversal into current credits',async()=>{
        const f=await fixture();
        await db.query("UPDATE commercial.periods SET starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' WHERE id=$1",[f.period.id]);
        await db.query(`INSERT INTO commercial.periods(id,account_id,plan,starts_at,ends_at,allowance,used,key_limit,rate_limit,concurrency)
            VALUES ($1,$2,'business',now()-interval '1 day',now()+interval '29 days',100000,7,5,300,2)`,['new-'+f.account.id,f.account.id]);
        await terminal(f);
        const report=await q.dashboard(f.account.id);
        assert.equal(await used(f),0);assert.equal(report.used,7);assert.equal(report.remaining,99993);assert.equal(report.returned_credits,0);
        assert.equal(report.preparation_refunds[0].period_id,f.period.id);
        assert.ok(new Date(report.preparation_refunds[0].period_ends_at)<new Date());
    });
    test('the immutable actual debit is reversed even when different from today’s operation price',async()=>{
        const f=await fixture({rawCredits:37});
        await assert.rejects(db.query('UPDATE commercial.preparation_charges SET credits=100 WHERE job_id=$1',[f.job.id]),/immutable/);
        await terminal(f);assert.equal(await used(f),0);assert.equal((await q.dashboard(f.account.id)).returned_credits,37);
        await assert.rejects(db.query("UPDATE commercial.preparation_charges SET outcome='succeeded',reversal_reason=NULL WHERE job_id=$1",[f.job.id]),/immutable/);
    });
    test('failed refresh refunds its charge despite an older usable table',async()=>{
        const f=await fixture();
        await db.query(`INSERT INTO ingested_resources(resource_id,table_name,row_count,byte_size,columns,status,source_version)
            VALUES ($1,$2,12,100,'[]','ready','older-version')`,[f.resource,'old_'+f.account.id.replaceAll('-','')]);
        await terminal(f);
        assert.equal(await used(f),0);
        assert.equal((await db.query('SELECT row_count FROM ingested_resources WHERE resource_id=$1',[f.resource])).rows[0].row_count,'12');
    });
    test('publication wins over bookkeeping failure and later expiry, including an empty result',async()=>{
        const f=await fixture();await receipt(f);
        await db.query(`INSERT INTO ingested_resources(resource_id,table_name,row_count,byte_size,columns,status,source_version)
            VALUES ($1,$2,0,0,'[]','ready',$3)`,[f.resource,'empty_'+f.account.id.replaceAll('-',''),f.version]);
        await db.query('DELETE FROM ingested_resources WHERE resource_id=$1',[f.resource]);
        await terminal(f);
        assert.equal(await used(f),100);assert.equal((await charge(f)).outcome,'succeeded');
        assert.equal((await db.query('SELECT status FROM ingest_jobs WHERE id=$1',[f.job.id])).rows[0].status,'done');
    });
    test('durable debits survive request-log retention and missing jobs remain unresolved',async()=>{
        const f=await fixture();
        await db.query("UPDATE commercial.requests SET created_at=now()-interval '8 days' WHERE id=$1",[f.request]);
        await q.maintenance();
        assert.equal((await db.query('SELECT count(*)::int AS n FROM commercial.requests WHERE id=$1',[f.request])).rows[0].n,0);
        assert.ok(await charge(f));await terminal(f);assert.equal(await used(f),0);
        const missing=await fixture();await db.query('DELETE FROM ingest_jobs WHERE id=$1',[missing.job.id]);
        await accounting.reconcilePreparations();assert.equal(await used(missing),100);assert.equal((await charge(missing)).outcome,'pending');
        assert.ok((await admin.status()).missing_preparation_jobs>=1);
    });
    test('busy resource reconciliation skips without waiting; caller timeouts never fail active jobs',async()=>{
        const f=await fixture();await db.query("UPDATE ingest_jobs SET status='failed' WHERE id=$1",[f.job.id]);
        const c=await db.connect();
        try {
            await c.query('BEGIN');await lockIngestResource(c,f.resource);
            const result=await accounting.reconcilePreparations();assert.ok(result.skipped>=1);assert.equal(await used(f),100);
        } finally {await c.query('ROLLBACK');c.release();}
        await accounting.reconcilePreparations();assert.equal(await used(f),0);
        const active=await fixture();await running(active);
        await db.query("UPDATE ingest_jobs SET heartbeat_at=now()-interval '2 days' WHERE id=$1",[active.job.id]);
        await q.abortRequest(active.request);await accounting.reconcilePreparations();assert.equal(await used(active),100);
        assert.equal((await charge(active)).outcome,'pending');
    });
    test('cutover adopts only exact reviewed active debit pairs and refuses terminal or ambiguous history',async()=>{
        const valid=await fixture({rawCredits:42,ledger:false});
        const ambiguous=await fixture({rawCredits:42,ledger:false});
        await db.query(`INSERT INTO commercial.requests(id,account_id,period_id,operation,credits,state,expires_at,job_id)
            VALUES ($1,$2,$3,'preparation',42,'charged',now(),$4)`,[randomUUID(),ambiguous.account.id,ambiguous.period.id,ambiguous.job.id]);
        const preview=await accounting.adoptActivePreparations();
        const candidate=preview.candidates.find(c=>c.job_id===valid.job.id);
        assert.equal(candidate.eligible,true);assert.equal(preview.candidates.find(c=>c.job_id===ambiguous.job.id).eligible,false);
        assert.equal(await charge(valid),undefined);
        await assert.rejects(accounting.adoptActivePreparations(db,{apply:true,candidates:[{...candidate,request_id:randomUUID()}]}),/changed/);
        await accounting.adoptActivePreparations(db,{apply:true,candidates:[candidate]});
        assert.equal((await charge(valid)).credits,42);await terminal(valid);assert.equal(await used(valid),0);
        await db.query("UPDATE ingest_jobs SET status='failed' WHERE id=$1",[ambiguous.job.id]);
        await assert.rejects(accounting.adoptActivePreparations(db,{apply:true,candidates:[{job_id:ambiguous.job.id,request_id:ambiguous.request}]}),/changed/);
    });
    test('cutover refuses running and requeued old jobs whose publication history is uncertain',async()=>{
        for(const state of ['pending','running']) {
            const f=await fixture({rawCredits:42,ledger:false});
            await db.query('UPDATE ingest_jobs SET status=$2,attempts=1,claimed_at=now() WHERE id=$1',[f.job.id,state]);
            const preview=await accounting.adoptActivePreparations();
            const candidate=preview.candidates.find(c=>c.job_id===f.job.id);
            assert.equal(candidate.eligible,false);assert.equal(candidate.reason,'publication_uncertain');
            await assert.rejects(accounting.adoptActivePreparations(db,{apply:true,candidates:[candidate]}),/changed/);
            assert.equal(await charge(f),undefined);assert.equal(await used(f),42);
        }
    });
    test('maintenance retains unresolved old debits and removes only outcomes resolved over thirteen months ago',async()=>{
        const pending=await fixture({rawCredits:37,ledger:false});
        const resolved=await fixture({rawCredits:37,ledger:false});
        for(const f of [pending,resolved]) {
            await db.query("UPDATE commercial.requests SET created_at=now()-interval '14 months' WHERE id=$1",[f.request]);
            await db.query(`INSERT INTO commercial.preparation_charges(request_id,job_id,account_id,period_id,credits,charged_at,outcome,resolved_at)
                SELECT id,job_id,account_id,period_id,credits,created_at,$2,
                    CASE WHEN $2='succeeded' THEN now()-interval '14 months' ELSE NULL END
                FROM commercial.requests WHERE id=$1`,[f.request,f===resolved?'succeeded':'pending']);
        }
        await q.maintenance();
        assert.equal((await charge(pending)).outcome,'pending');assert.equal(await charge(resolved),undefined);
        await terminal(pending);assert.equal(await used(pending),0);
    });
    test('reconciliation respects its bounded batch and leaves later eligible work for another pass',async()=>{
        const first=await fixture();const second=await fixture();
        await db.query("UPDATE ingest_jobs SET status='failed' WHERE id=ANY($1::bigint[])",[[first.job.id,second.job.id]]);
        const result=await accounting.reconcilePreparations(db,1);
        assert.equal(result.examined,1);assert.equal(result.resolved,1);
        assert.equal((await charge(first)).outcome,'refunded');assert.equal((await charge(second)).outcome,'pending');
        await accounting.reconcilePreparations();assert.equal((await charge(second)).outcome,'refunded');
    });
    test('inconsistent original usage refuses a refund atomically instead of creating negative usage',async()=>{
        const f=await fixture();await db.query('UPDATE commercial.periods SET used=0 WHERE id=$1',[f.period.id]);
        await assert.rejects(terminal(f),/does not reconcile/);
        assert.equal((await charge(f)).outcome,'pending');assert.equal(await used(f),0);
        assert.equal((await db.query('SELECT status FROM ingest_jobs WHERE id=$1',[f.job.id])).rows[0].status,'running');
        await db.query('UPDATE commercial.periods SET used=100 WHERE id=$1',[f.period.id]);
        await terminal(f);assert.equal(await used(f),0);
    });
    test('cached successful requests remain billable and interrupted exports retain existing refunds',async()=>{
        const express=require('express');const request=require('supertest');
        const {commercialApi}=require('../middleware/commercialApi');
        const f=await fixture({charged:false});const app=express();app.use(commercialApi);
        app.get('/query',(_req,res)=>res.set('ETag','fixture-cache').json({cached:true}));
        app.get('/query.csv',(_req,res)=>{res.type('text/csv');res.write('header\n');res.destroy();});
        for(let n=0;n<2;n++) assert.equal((await request(app).get('/query').set('Authorization','Bearer '+f.key.secret).set('If-None-Match','fixture-cache')).status,200);
        assert.equal(await used(f),2);
        await assert.rejects(request(app).get('/query.csv').set('Authorization','Bearer '+f.key.secret));
        for(let n=0;n<50;n++) {
            if((await q.dashboard(f.account.id)).reserved===0) break;
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.equal(await used(f),2);assert.equal((await q.dashboard(f.account.id)).reserved,0);
    });
}
