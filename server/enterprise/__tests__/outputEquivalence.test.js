// Byte-level guard for the open-core refactor. With the extension installed,
// the combined build must keep canquery.com's API contract, initial HTML,
// plans, crawl files and route preloads exactly as captured from 466975e.
jest.mock('../../db/catalogReadQueries', () => new Proxy({}, {
    get: (target, name) => (target[name] ||= jest.fn(async () => (/^(count|get)/.test(String(name)) ? null : [])))
}));

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const NOW = Date.parse('2026-10-13T00:00:00Z');
const BASE = { SITE_URL: 'https://canquery.com', ANALYTICS_WEBSITE_ID: '01a02c60-cd0a-77f4-8680-7e9e317534a1' };
const LIVE = { ...BASE, COMMERCIAL_API_ENABLED: 'true', STRIPE_MODE: 'live', BETTER_AUTH_SECRET: 'x'.repeat(40),
    SMTP_HOST: 'mail.example.test', SMTP_USER: 'accounts', SMTP_PASSWORD: 'example',
    STRIPE_SECRET_KEY: 'rk_live_example', STRIPE_BUSINESS_PRICE_ID: 'price_example', STRIPE_LIVE_READY: 'true' };
const VARIANTS = {
    live: LIVE,
    disabled: BASE,
    sunset: { ...LIVE, API_KEY_REQUIRED_AT: '2099-01-01T00:00:00Z' },
    sandbox: { ...BASE, COMMERCIAL_API_ENABLED: 'true', STRIPE_MODE: 'sandbox', BETTER_AUTH_SECRET: 'x'.repeat(40) }
};
const PAGES = ['/', '/docs', '/pricing', '/pricing/', '/terms', '/faq', '/about', '/privacy', '/login', '/signup',
    '/forgot-password', '/reset-password', '/account', '/account?tab=keys', '/no-such-page'];
const MODULES = ['HomePage', 'DatasetsPage', 'DatasetPage', 'ResourcePage', 'OrganizationsPage', 'OrganizationPage',
    'PlacesPage', 'PlacePage', 'InsightsPage', 'DocsPage', 'PrivacyPage', 'FaqPage', 'AboutPage', 'BlogPage',
    'PricingPage', 'AccountPage', 'TermsPage', 'AuthPage'];
const KEYS = [...new Set(Object.values(VARIANTS).flatMap(Object.keys)), 'API_KEY_REQUIRED_AT'];
const saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function use(env) {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, env);
}
// The live variant keeps full text for reviewable diffs; the others keep digests.
function expectOutput(name, value) {
    expect(name === 'live' ? value : digest(value)).toMatchSnapshot();
}

let distDir;
let spa;
beforeAll(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-equivalence-'));
    fs.writeFileSync(path.join(distDir, 'index.html'),
        '<!doctype html><html><head><!-- seo:start --><title>x</title><!-- seo:end -->' +
        '<!-- analytics:config --></head><body><div id="root"></div></body></html>');
    const manifest = Object.fromEntries(MODULES.map(name => ['src/pages/' + name + '.jsx',
        { file: 'assets/' + name + '-abc123.js', css: ['assets/' + name + '-abc123.css'], imports: ['src/shared.js'] }]));
    manifest['src/shared.js'] = { file: 'assets/shared-abc123.js' };
    fs.writeFileSync(path.join(distDir, 'asset-manifest.json'), JSON.stringify(manifest));
    spa = express();
    spa.get(/.*/, require('../../controllers/spaController').serveSpa(distDir));
});
afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    fs.rmSync(distDir, { recursive: true, force: true });
});

describe.each(Object.keys(VARIANTS))('combined build output (%s)', name => {
    beforeEach(() => use(VARIANTS[name]));

    test('OpenAPI document', () => {
        expectOutput(name, JSON.stringify(require('../../services/openApi').buildOpenApi({ env: process.env, now: NOW })));
    });

    test('initial HTML, status and cache headers', async () => {
        const pages = {};
        for (const page of PAGES) {
            const response = await request(spa).get(page);
            pages[page] = { status: response.status, location: response.headers.location || null,
                cacheControl: response.headers['cache-control'] || null, body: response.text };
        }
        expectOutput(name, pages);
    });

    test('public plans, robots.txt and static sitemap', async () => {
        const app = require('../../app');
        const responses = {};
        for (const target of ['/api/account/plans', '/robots.txt', '/sitemap-pages.xml']) {
            const response = await request(app).get(target);
            responses[target] = { status: response.status, cacheControl: response.headers['cache-control'] || null, body: response.text };
        }
        expectOutput(name, responses);
    });
});

test('route preloads for every page type', () => {
    const { routeAssets } = require('../../services/routeAssets');
    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'asset-manifest.json'), 'utf8'));
    expect(Object.fromEntries(PAGES.map(page => [page, routeAssets(page, manifest)]))).toMatchSnapshot();
});

test('public component names and sanitized metrics', () => {
    const { COMPONENTS, sanitizeComponent } = require('../../services/componentHealth');
    const metrics = ['service_active', 'database_ready', 'mail_services_active', 'eligible_pending', 'running',
        'stale_running', 'oldest_pending_seconds', 'failed_resources', 'failed_jobs', 'stale_jobs',
        'capacity_failures_last_hour', 'expired_reservations', 'billing_retries', 'delayed_billing_events',
        'failed_mail', 'delayed_mail', 'terminal_preparation_charges', 'missing_preparation_jobs',
        'last_attempt_ok', 'attempt_in_progress', 'last_attempt_age_seconds', 'latest_success_age_seconds',
        'free_bytes', 'operating_margin_bytes', 'emergency_floor_bytes', 'unlisted_metric'];
    const checks = Object.fromEntries(metrics.map((metric, index) => [metric, index]));
    const document = { version: 1, generated_at: new Date(NOW).toISOString(),
        components: Object.fromEntries(['availability', 'preparation', 'maps', 'sources', 'commercial', 'backups', 'storage', 'other']
            .map(component => [component, { ok: true, status: 'ok', checks }])) };
    expect({ COMPONENTS, sanitized: COMPONENTS.map(component => sanitizeComponent(document, component, NOW)) }).toMatchSnapshot();
});
