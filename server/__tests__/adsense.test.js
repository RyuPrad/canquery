jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(),
    getDatasetByIdOrName: jest.fn(),
    listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(),
    listOrganizations: jest.fn(),
    listPlaces: jest.fn(),
    getOrganizationByName: jest.fn(),
    getStats: jest.fn(),
    listTopDownloadLinks: jest.fn(),
    getPlaceByIdOrSlug: jest.fn(),
    pingDb: jest.fn(),
    getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn(),
    getJobHealth: jest.fn(),
}));
jest.mock('../services/catalogFacets', () => ({ datasetFacets: jest.fn(), refreshDatasetFacets: jest.fn(), startFacetWarming: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));

const request = require('supertest');
const express = require('express');
const helmet = require('helmet');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalogRead = require('../db/catalogReadQueries');
const adsense = require('../services/adsense');
const { CSP_DIRECTIVES } = require('../config/contentSecurityPolicy');
const { serveSpa } = require('../controllers/spaController');
const { staticSnapshot } = require('../services/seoSnapshot');

const CLIENT = 'ca-pub-9765393503852455';
const LOADER = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT +
    '" crossorigin="anonymous" nonce="';
// The policy production served before this change; ads must not alter it.
const SITE_POLICY = "img-src 'self' data: blob: https://maps-cartes.services.geo.ca;connect-src 'self' https://maps-cartes.services.geo.ca;" +
    "worker-src 'self' blob:;default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';" +
    "frame-ancestors 'self';object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';" +
    'upgrade-insecure-requests';
// A built index.html in miniature: theme script, both markers, the managed SEO
// block, Vite's entry, a modulepreload and the stylesheet.
const TEMPLATE = '<!doctype html><html><head>\n' +
    '    <script src="/theme-init.js"></script>\n' +
    '    <!-- analytics:config -->\n' +
    '    <!-- ads:config -->\n' +
    '    <!-- seo:start --><title>x</title><!-- seo:end -->\n' +
    '    <script type="module" crossorigin src="/assets/index-a.js"></script>\n' +
    '    <link rel="modulepreload" crossorigin href="/assets/i18n-b.js">\n' +
    '    <link rel="stylesheet" crossorigin href="/assets/index-c.css">\n' +
    '</head><body><div id="root"></div></body></html>';
const MANIFEST = {
    'src/pages/FaqPage.jsx': { file: 'assets/FaqPage-d.js', imports: ['_shared-e.js'], css: ['assets/FaqPage-f.css'] },
    '_shared-e.js': { file: 'assets/shared-e.js' }
};

const nonceOf = res => res.headers['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1];
const scriptTags = html => [...html.matchAll(/<script\b[^>]*>/g)].map(match => match[0]);

let distDir;
let plainDir;
let spa;
let plainSpa;
let previous;

function siteApp(dir) {
    // Helmet in front of the handler, as in app.js, so header replacement is real.
    const app = express();
    app.use(helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }));
    app.get(/.*/, serveSpa(dir));
    return app;
}

beforeAll(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-ads-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), TEMPLATE);
    fs.writeFileSync(path.join(distDir, 'asset-manifest.json'), JSON.stringify(MANIFEST));
    // The same build before the ads marker existed.
    plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-plain-'));
    fs.writeFileSync(path.join(plainDir, 'index.html'), TEMPLATE.replace('    <!-- ads:config -->\n', ''));
    fs.writeFileSync(path.join(plainDir, 'asset-manifest.json'), JSON.stringify(MANIFEST));
    spa = siteApp(distDir);
    plainSpa = siteApp(plainDir);
});

afterAll(() => {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(plainDir, { recursive: true, force: true });
});

beforeEach(() => {
    previous = process.env.ADSENSE_CLIENT;
    delete process.env.ADSENSE_CLIENT;
});

afterEach(() => {
    if (previous === undefined) delete process.env.ADSENSE_CLIENT;
    else process.env.ADSENSE_CLIENT = previous;
});

describe('AdSense configuration', () => {
    it('accepts only a ca-pub publisher id and treats blank as off', () => {
        expect(adsense.adsenseClient('')).toBeNull();
        expect(adsense.adsenseClient('   ')).toBeNull();
        expect(adsense.adsenseClient(undefined)).toBeNull();
        expect(adsense.adsenseClient(' ' + CLIENT + ' ')).toBe(CLIENT);
        for (const bad of ['pub-9765393503852455', 'ca-pub-976539350385245', 'ca-pub-97653935038524555', CLIENT + '"><script>']) {
            expect(() => adsense.adsenseClient(bad)).toThrow('ADSENSE_CLIENT');
        }
    });

    it('derives the ads.txt line from the publisher id', () => {
        expect(adsense.adsTxtLine(CLIENT)).toBe('google.com, pub-9765393503852455, DIRECT, f08c47fec0942fa0');
    });

    it('creates a fresh 128-bit nonce each time', () => {
        const nonce = adsense.createNonce();
        expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
        expect(adsense.createNonce()).not.toBe(nonce);
    });
});

describe('content security policies', () => {
    it('keeps the site-wide policy exactly as before', async () => {
        const app = express();
        app.use(helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }));
        app.get('/x', (_req, res) => res.send('x'));
        const res = await request(app).get('/x');
        expect(res.headers['content-security-policy']).toBe(SITE_POLICY);
    });

    it('opens only what Google’s ad code needs on ad pages', () => {
        const directives = Object.fromEntries(adsense.adPagePolicy('N0nce').split(';').map(part => {
            const [name, ...values] = part.split(' ');
            return [name, values.join(' ')];
        }));
        expect(directives['script-src']).toBe("'nonce-N0nce' 'strict-dynamic' 'unsafe-inline' 'unsafe-eval' https: http:");
        expect(directives['frame-src']).toBe('https:');
        expect(directives['img-src']).toBe("'self' data: blob: https://maps-cartes.services.geo.ca https:");
        expect(directives['connect-src']).toBe("'self' https://maps-cartes.services.geo.ca https:");
        expect(directives).toMatchObject({
            'default-src': "'self'", 'worker-src': "'self' blob:", 'object-src': "'none'", 'base-uri': "'self'",
            'frame-ancestors': "'self'", 'form-action': "'self'", 'script-src-attr': "'none'",
            'style-src': "'self' https: 'unsafe-inline'", 'font-src': "'self' https: data:", 'upgrade-insecure-requests': ''
        });
        expect(adsense.adPagePolicy('N0nce').match(/script-src /g)).toHaveLength(1);
    });

    it('marks only the template’s scripts and modulepreloads', () => {
        const marked = adsense.markTemplateNonces(TEMPLATE);
        const placeholder = 'nonce="' + adsense.NONCE_PLACEHOLDER + '"';
        expect(marked).toContain('<script ' + placeholder + ' src="/theme-init.js">');
        expect(marked).toContain('<script ' + placeholder + ' type="module"');
        expect(marked).toContain('<link ' + placeholder + ' rel="modulepreload"');
        expect(marked).toContain('<link rel="stylesheet" crossorigin href="/assets/index-c.css">');
    });
});

describe('ad pages', () => {
    it('leaves pages exactly as before when ads are off', async () => {
        const res = await request(spa).get('/faq');
        expect(res.status).toBe(200);
        expect(res.text).toBe((await request(plainSpa).get('/faq')).text);
        expect(res.text).not.toMatch(/ads:config|nonce|adsbygoogle|google-adsense-account/);
        expect(res.headers['content-security-policy']).toBe(SITE_POLICY);
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
        expect(res.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    });

    it('loads the ad code under one nonce that every executable tag carries', async () => {
        process.env.ADSENSE_CLIENT = CLIENT;
        const res = await request(spa).get('/faq');
        expect(res.status).toBe(200);
        const nonce = nonceOf(res);
        expect(nonce).toBeTruthy();
        expect(res.headers['content-security-policy']).toBe(adsense.adPagePolicy(nonce));
        expect(res.text).toContain(LOADER + nonce + '"></script>');
        expect(res.text).toContain('<meta name="google-adsense-account" content="' + CLIENT + '" />');
        expect(res.text).toContain('<meta property="csp-nonce" nonce="' + nonce + '" />');
        // Theme script, entry module and loader; JSON-LD data blocks need none.
        const executable = scriptTags(res.text).filter(tag => !/type="application\/(ld\+)?json"/.test(tag));
        expect(executable).toHaveLength(3);
        for (const tag of executable) expect(tag).toContain('nonce="' + nonce + '"');
        expect(res.text).toContain('<link nonce="' + nonce + '" rel="modulepreload" crossorigin href="/assets/i18n-b.js">');
        expect(res.text).toContain('<link rel="modulepreload" nonce="' + nonce + '" crossorigin href="/assets/FaqPage-d.js" />');
        expect(res.text).toContain('<link rel="stylesheet" crossorigin href="/assets/FaqPage-f.css" />');
        expect(res.text).not.toContain(adsense.NONCE_PLACEHOLDER);
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
        expect(res.headers['cache-control']).toBe('private, no-cache');
    });

    it('uses a new nonce for every page load and the same headers for HEAD', async () => {
        process.env.ADSENSE_CLIENT = CLIENT;
        const first = await request(spa).get('/');
        const second = await request(spa).get('/');
        expect(nonceOf(first)).toBeTruthy();
        expect(nonceOf(second)).not.toBe(nonceOf(first));
        const head = await request(spa).head('/');
        expect(head.status).toBe(200);
        expect(nonceOf(head)).toBeTruthy();
        expect(head.headers['cache-control']).toBe('private, no-cache');
    });

    it('never puts the nonce into catalogue text', async () => {
        process.env.ADSENSE_CLIENT = CLIENT;
        catalogRead.getDatasetByIdOrName.mockResolvedValue({
            id: 'd1', name: 'roads', title_en: 'Roads ' + adsense.NONCE_PLACEHOLDER + ' <script>alert(1)</script>',
            notes_en: 'Road data ' + adsense.NONCE_PLACEHOLDER
        });
        catalogRead.listResourcesForDataset.mockResolvedValue([]);
        const res = await request(spa).get('/datasets/roads');
        expect(res.status).toBe(200);
        const nonce = nonceOf(res);
        // The title arrives (catalogue cleaning drops the underscores), escaped and without a nonce.
        expect(res.text).toContain('<h1>Roads CANQUERY_CSP_NONCE');
        expect(res.text).not.toContain('<script>alert(1)</script>');
        // Theme script, entry module and loader, the csp-nonce meta and one modulepreload.
        expect(res.text.split(nonce).length - 1).toBe(5);
    });

    it('keeps 404s, 503s and RouteHead fetches free of ads', async () => {
        process.env.ADSENSE_CLIENT = CLIENT;
        const missing = await request(spa).get('/no-such-page');
        expect(missing.status).toBe(404);
        catalogRead.getDatasetByIdOrName.mockRejectedValue(new Error('Catalogue unavailable'));
        const outage = await request(spa).get('/datasets/roads');
        expect(outage.status).toBe(503);
        const fetched = await request(spa).get('/faq').set('Sec-Fetch-Dest', 'empty').set('Sec-Fetch-Mode', 'cors');
        expect(fetched.status).toBe(200);
        for (const res of [missing, outage, fetched]) {
            expect(res.text).not.toMatch(/adsbygoogle|nonce=/);
            expect(res.text).toContain('<meta name="google-adsense-account" content="' + CLIENT + '" />');
            expect(res.headers['content-security-policy']).toBe(SITE_POLICY);
            expect(res.headers['referrer-policy']).toBe('no-referrer');
        }
        const navigation = await request(spa).get('/faq').set('Sec-Fetch-Dest', 'document').set('Sec-Fetch-Mode', 'navigate');
        expect(navigation.text).toContain(LOADER + nonceOf(navigation) + '"></script>');
    });
});

describe('ads.txt', () => {
    const app = express();
    app.use(require('../routes/seo'));
    app.use((_req, res) => res.status(404).send('missing'));

    it('names the publisher as a direct seller when ads are on', async () => {
        process.env.ADSENSE_CLIENT = CLIENT;
        const res = await request(app).get('/ads.txt');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(res.headers['cache-control']).toBe('public, max-age=86400');
        expect(res.text).toBe('google.com, pub-9765393503852455, DIRECT, f08c47fec0942fa0\n');
        const head = await request(app).head('/ads.txt');
        expect(head.status).toBe(200);
    });

    it('does not exist when ads are off', async () => {
        const res = await request(app).get('/ads.txt');
        expect(res.status).toBe(404);
    });
});

describe('server-rendered privacy page', () => {
    it('discloses advertising only when ads are on', () => {
        expect(staticSnapshot('privacy', [])).not.toContain('Advertising');
        process.env.ADSENSE_CLIENT = CLIENT;
        const html = staticSnapshot('privacy', []);
        expect(html).toContain('<h2>Advertising</h2>');
        expect(html).toContain('Third-party vendors, including Google, use cookies to serve ads based on your prior visits');
        expect(html).toContain('https://www.google.com/settings/ads');
        expect(html).toContain('www.aboutads.info');
        expect(html).toContain('Do Not Track and Global Privacy Control turn off CanQuery’s analytics but not Google’s ad code.');
    });
});
