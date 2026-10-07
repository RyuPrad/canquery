const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireOwner } = require('../services/authRuntime');
const { config, PLANS, CREDIT_COSTS, WORKFLOW_COSTS, BUSINESS_PRICE, TERMS_VERSION } = require('../services/commercialConfig');
const queries = require('../db/commercialQueries');
const billing = require('../services/billingService');
const { envelope } = require('../utils/envelope');
const router = express.Router();
router.get('/plans',(_req,res)=>{
    const { enabled,mode,checkout,sunset } = config();
    res.set('Cache-Control','no-store').json(envelope({enabled,mode,checkout,sunset,plans:PLANS,
        credit_costs:CREDIT_COSTS,workflow_costs:WORKFLOW_COSTS,business_price:BUSINESS_PRICE,terms_version:TERMS_VERSION}));
});
router.use(rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false}));
router.use(requireOwner);
router.use(async (req,_res,next)=>{
    req.account = await queries.accountForUser(req.owner.id);
    if (req.account.suspended_at) throw queries.failure('Account unavailable','ACCOUNT_SUSPENDED',403);
    next();
});
router.get('/',async(req,res)=>res.json(envelope({user:{name:req.owner.name,email:req.owner.email},
    ...await queries.dashboard(req.account.id),billing_customer:Boolean(req.account.stripe_customer_id),
    checkout_available:config().checkout,mode:config().mode,business_price:BUSINESS_PRICE,terms_version:TERMS_VERSION})));
router.post('/keys',async(req,res)=>res.status(201).json(envelope(await queries.createKey(req.account.id,req.body?.name))));
router.delete('/keys/:id',async(req,res)=>{await queries.revokeKey(req.account.id,req.params.id);res.sendStatus(204);});
router.post('/checkout',async(req,res)=>res.json(envelope(await billing.checkout(req.account.id,req.owner))));
router.post('/portal',async(req,res)=>res.json(envelope(await billing.portal(req.account.id))));
module.exports = router;
