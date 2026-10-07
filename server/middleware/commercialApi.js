const queries = require('../db/commercialQueries');
const pool = require('../db/pool');
const { config } = require('../services/commercialConfig');
const { operationFor, isPublicOperation } = require('../services/commercialOperations');
const rateLimit = require('express-rate-limit');

// Failed credential attempts must be bounded before they can query PostgreSQL.
// Successful keyed traffic uses its durable per-account limits instead.
const credentialLimiter = rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false,
    skip:req=>!req.headers.authorization,skipSuccessfulRequests:true});

function privateResponse(res) {
    // Controllers may set a public cache policy; authenticated responses must
    // stay private even for tiles, errors and conditional requests.
    const setHeader = res.setHeader;
    res.setHeader = function(name,value) {
        return setHeader.call(this,name,String(name).toLowerCase()==='cache-control' ? 'private, no-store' : value);
    };
    res.setHeader('Cache-Control','private, no-store');
    res.vary('Authorization');
}
async function commercialApi(req,res,next) {
    try {
        if (isPublicOperation(req)) return next();
        const settings = config();
        const header = req.headers.authorization;
        if (!header) {
            if (settings.enabled && settings.sunset) {
                res.setHeader('Deprecation','@'+Math.floor((Date.parse(settings.sunset)-30*86400000)/1000));
                res.setHeader('Sunset',new Date(settings.sunset).toUTCString());
                res.setHeader('Link','<'+settings.origin+'/docs>; rel="deprecation"');
                if (Date.now()>=Date.parse(settings.sunset)) throw queries.failure('An API key is required', 'API_KEY_REQUIRED',401);
            }
            return next();
        }
        privateResponse(res);
        if (!settings.enabled) throw queries.failure('API accounts are not available yet','ACCOUNTS_UNAVAILABLE',503);
        if (!/^Bearer [^ ]+$/.test(header)) throw queries.failure('Use Authorization: Bearer YOUR_API_KEY','INVALID_API_KEY',401);
        const identity = await queries.authenticate(header.slice(7));
        const operation = operationFor(req);
        const context = await queries.reserve(identity,operation);
        req.commercial = context;
        for (const name of ['if-none-match','if-modified-since']) delete req.headers[name];
        res.setHeader('X-CanQuery-Credits-Limit',String(context.limit));
        res.setHeader('X-CanQuery-Credits-Remaining',String(context.remaining));
        res.setHeader('X-CanQuery-Credits-Reset',new Date(context.resets_at).toISOString());
        if (!operation.cost) return next();
        let finishing;
        const finish = charge => {
            finishing = (finishing || Promise.resolve()).then(()=>queries.settle(context.id,charge));
            return finishing;
        };
        const heartbeat = setInterval(()=>{
            pool.query("UPDATE commercial.requests SET expires_at=now()+interval '5 minutes' WHERE id=$1 AND state='reserved'",[context.id])
                .catch(()=>res.destroy());
        },30000);
        heartbeat.unref();
        const deadline = setTimeout(()=>res.destroy(),4*60000);
        deadline.unref();
        const end = res.end;
        let ending = false;
        res.end = function(...args) {
            if (ending) return this;
            ending = true;
            finish(res.statusCode >= 200 && res.statusCode < 400).then(()=>{
                if (!res.destroyed) end.apply(res,args);
            }).catch(()=>res.destroy());
            return this;
        };
        res.on('close',()=>{
            clearInterval(heartbeat);
            clearTimeout(deadline);
            if (!res.writableFinished) {
                (finishing || Promise.resolve()).catch(()=>{}).then(()=>queries.abortRequest(context.id)).catch(()=>{});
            }
        });
        next();
    } catch (err) {
        next(err.isOperational ? err : queries.failure('API accounting is temporarily unavailable','ACCOUNTING_UNAVAILABLE',503));
    }
}
module.exports = { commercialApi, credentialLimiter, operationFor };
