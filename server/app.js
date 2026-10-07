require('dotenv/config');

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const AppError = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');
const requestId = require('./middleware/requestId');
const { generalLimiter } = require('./middleware/rateLimits');
const catalogController = require('./controllers/catalogController');
const datasetsRouter = require('./routes/datasets');
const resourcesRouter = require('./routes/resources');
const organizationsRouter = require('./routes/organizations');
const statsRouter = require('./routes/stats');
const repoRouter = require('./routes/repo');
const jobsRouter = require('./routes/jobs');
const opsRouter = require('./routes/ops');
const insightsRouter = require('./routes/insights');
const placesRouter = require('./routes/places');
const sourcesRouter = require('./routes/sources');
const seoRouter = require('./routes/seo');
const spaController = require('./controllers/spaController');
const { commercialApi, credentialLimiter } = require('./middleware/commercialApi');
const { authHandler } = require('./services/authRuntime');
const { receiveWebhook } = require('./services/billingService');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            'img-src': ["'self'", 'data:', 'blob:', 'https://maps-cartes.services.geo.ca'],
            'connect-src': ["'self'", 'https://maps-cartes.services.geo.ca'],
            'worker-src': ["'self'", 'blob:']
        }
    }
}));
app.use(requestId);

// API responses remain crawlable for rendering, but are not search landing pages.
// Mount before CORS, authentication and rate limiting so failures carry it too.
app.use(['/api/v1', '/web-api/v1'], (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex');
    next();
});

// Build CORS allowlist
const allowlist = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(o => o)
);
if (process.env.SITE_URL) allowlist.add(new URL(process.env.SITE_URL).origin);
if (process.env.NODE_ENV !== 'production') {
    allowlist.add('http://localhost:5173');
    allowlist.add('http://127.0.0.1:5173');
}

// CORS middleware
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return next();
    }

    // Same-origin requests carry an Origin header too (e.g. module scripts
    // are always fetched in CORS mode) - the app's own origin is always allowed.
    const selfOrigin = req.protocol + '://' + req.headers.host;
    if (allowlist.has(origin) || origin === selfOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        return next();
    }

    return res.status(403).json({ error: 'Origin not allowed' });
});

// Signature verification and Better Auth both need the original request stream.
app.post('/api/stripe/webhook', express.raw({type:'application/json',limit:'1mb'}), async(req,res)=>{
    await receiveWebhook(req.body,req.headers['stripe-signature']);
    res.set('Cache-Control','no-store').json({received:true});
});
app.all('/api/auth/*splat', authHandler);
app.use(express.json({limit:'64kb'}));
app.use('/api/account', require('./routes/account'));

app.get('/healthz', catalogController.healthz);

app.use('/api/v1', credentialLimiter, commercialApi);
app.use(['/api','/web-api'], generalLimiter);
for (const base of ['/api/v1','/web-api/v1']) {
    app.use(base+'/datasets', datasetsRouter);
    app.use(base+'/resources', resourcesRouter);
    app.use(base+'/organizations', organizationsRouter);
    app.use(base+'/stats', statsRouter);
    app.use(base+'/repo', repoRouter);
    app.use(base+'/jobs', jobsRouter);
    app.use(base+'/ops', opsRouter);
    app.use(base+'/insights', insightsRouter);
    app.use(base+'/places', placesRouter);
    app.use(base+'/sources', sourcesRouter);
    app.use(base+'/blog', require('./routes/blog'));
}
app.get('/api/v1/openapi.json', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(require('./services/openApi').buildOpenApi());
});

// Crawl-facing files (robots.txt + sitemaps) live at the site root and read
// from Postgres; mounted before the SPA so they win over the static catch-all.
app.use(seoRouter);

// In production the API also serves the built SPA (client/dist) so the public
// Caddy block stays a pure reverse_proxy - no extra container mounts on the
// shared box. API paths fall through to the JSON 404 below.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(clientDist)) {
    app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(clientDist, { index: false }));
    // Per-route SEO and initial content, with real 404s and retryable 503s.
    app.get(/^\/(?!api\/|web-api\/|healthz).*/, spaController.serveSpa(clientDist));
}

app.use((req, res, next) => {
    next(new AppError('Not found', 404));
});

app.use(errorHandler);

module.exports = app;
