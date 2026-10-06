const { config } = require('./commercialConfig');
const { failure } = require('../db/commercialQueries');
const pool = require('../db/pool');
const { createHmac, randomUUID } = require('crypto');
const AUTH_PATHS = new Set(['sign-up/email','sign-in/email','sign-out','request-password-reset','reset-password','verify-email','send-verification-email','get-session','ok']);
let runtime;
async function throttle(req) {
    const path = req.path.replace(/^\/api\/auth\//,'');
    const route = req.method === 'GET' && /^reset-password\/[A-Za-z0-9_-]{16,128}$/.test(path) ? 'reset-password' : path;
    if (!AUTH_PATHS.has(route)) throw failure('Not found','NOT_FOUND',404);
    const ip = createHmac('sha256',process.env.BETTER_AUTH_SECRET).update(req.ip || 'unknown').digest('hex');
    const slow = ['sign-up/email','request-password-reset','send-verification-email'].includes(route);
    for (const [bucket,window,max] of [['all',60000,30],[route,slow ? 3600000 : 60000,route==='get-session' ? 30 : 5]]) {
        const now = Date.now();
        const key = ip+':'+bucket+':'+Math.floor(now/window);
        const { rows } = await pool.query(`INSERT INTO canquery_auth."rateLimit"(id,key,count,"lastRequest") VALUES ($1,$2,1,$3)
            ON CONFLICT(key) DO UPDATE SET count=canquery_auth."rateLimit".count+1,"lastRequest"=EXCLUDED."lastRequest" RETURNING count`,[randomUUID(),key,now]);
        if (rows[0].count>max) throw failure('Too many authentication requests','AUTH_RATE_LIMIT',429,(window-now%window)/1000);
    }
}
function getAuth() {
    if (!config().enabled) throw failure('Accounts are not available yet','ACCOUNTS_UNAVAILABLE',503);
    if (!runtime) runtime = import('./auth.mjs').then(async module=>{
        await module.auth.$context;
        return module;
    }).catch(err=>{runtime=null;throw err;});
    return runtime;
}
async function authHandler(req,res,next) {
    try {
        const module = await getAuth();
        res.set('Cache-Control','private, no-store');
        await throttle(req);
        await module.handler(req,res);
    } catch (err) { next(err.isOperational ? err : failure('Authentication is temporarily unavailable','AUTH_UNAVAILABLE',503)); }
}
async function requireOwner(req,res,next) {
    try {
        res.set('Cache-Control','private, no-store');
        const session = await (await getAuth()).getSession(req.headers);
        if (!session) throw failure('Sign in to your account','SIGN_IN_REQUIRED',401);
        if (!session.user.emailVerified) throw failure('Verify your email first','EMAIL_VERIFICATION_REQUIRED',403);
        if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== config().origin) {
            throw failure('Request origin does not match this application','INVALID_ORIGIN',403);
        }
        req.owner = session.user;
        next();
    } catch (err) { next(err); }
}
module.exports = { getAuth, authHandler, requireOwner };
