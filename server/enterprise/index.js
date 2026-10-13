// Hosted canquery.com layer: developer accounts, API keys, credit metering and
// Stripe billing, registered through the core extension hooks in
// server/extensions/index.js. Modules load on first use, so the ingest worker
// only loads preparation accounting.
function mountBeforeBodyParsing(app) {
    const express = require('express');
    const AppError = require('../utils/AppError');
    const catchAsync = require('../utils/catchAsync');
    const { authAbuseLimiter, webhookLimiter } = require('../middleware/rateLimits');
    const { receiveWebhook } = require('../services/billingService');
    const { authHandler } = require('../services/authRuntime');
    // Verify Stripe signatures against the bounded, unmodified request bytes.
    app.post('/api/stripe/webhook', webhookLimiter, express.raw({type:'application/json',limit:'1mb'}), catchAsync(async(req,res)=>{
        await receiveWebhook(req.body,req.headers['stripe-signature']);
        res.set('Cache-Control','no-store').json({received:true});
    }));
    // Better Auth's Node adapter does not set its optional raw-body limit. Parse
    // only the two supported auth media types here so chunked bodies are bounded
    // before they reach authentication or PostgreSQL.
    const authJson = express.json({limit:'64kb'});
    const authForm = express.urlencoded({limit:'64kb',extended:false});
    app.use('/api/auth', authAbuseLimiter, (req,res,next) => {
        if (['GET','HEAD'].includes(req.method)) return next();
        if (req.is('application/json')) return authJson(req,res,next);
        if (req.is('application/x-www-form-urlencoded')) return authForm(req,res,next);
        return next(new AppError('Authentication requests require JSON or form data',415));
    });
    app.all('/api/auth/*splat', authHandler);
}

function mountAfterBodyParsing(app) {
    app.use('/api/account', require('../routes/account'));
}

function apiMiddleware() {
    const { commercialApi, credentialLimiter } = require('../middleware/commercialApi');
    return [credentialLimiter, commercialApi];
}

async function start() {
    const { config } = require('../services/commercialConfig');
    await require('../services/billingService').verifyEnvironment();
    if (!config().enabled) return {};
    await require('../services/authRuntime').getAuth();
    return { stopMaintenance: require('../services/commercialMaintenance').startMaintenance() };
}

async function close() {
    await require('../services/authRuntime').closeAuth();
}

const preparation = {
    charge: (client, context, jobId) => require('../db/commercialQueries').chargePreparation(client, context, jobId),
    settle: (client, jobId) => require('../db/preparationAccounting').settlePreparationOn(client, jobId)
};

module.exports = { edition: 'enterprise', mountBeforeBodyParsing, mountAfterBodyParsing, apiMiddleware, start, close, preparation };
