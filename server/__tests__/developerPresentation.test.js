const { pricingOverview, docsOverview } = require('../services/developerPresentation');
const { resolvePage } = require('../controllers/spaController');
const openApi = require('../services/openApi');
const savedEnv = { ...process.env };

beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...savedEnv };
    process.env.COMMERCIAL_API_ENABLED = 'true';
    process.env.STRIPE_MODE = 'sandbox';
    process.env.BETTER_AUTH_SECRET = 'fixture-auth-secret-with-more-than-32-characters';
    delete process.env.API_KEY_REQUIRED_AT;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_BUSINESS_PRICE_ID;
});
afterAll(() => { jest.restoreAllMocks(); process.env = savedEnv; });

test('initial pricing offers Free while paid checkout is closed', () => {
    const html = pricingOverview();
    expect(html).toContain('href="/signup"');
    expect(html).toContain('Coming soon. Paid signup is not open yet.');
    expect(html).not.toContain('Choose Business');
    expect(html).not.toContain('<h3>Custom &amp; Enterprise');
    expect(html).toContain('one existing supported resource');
    expect(html).toContain('the original allowance period');
    expect(html).toContain('103');
    expect(html).toContain('Test environment.');
});

test('initial pricing follows available sandbox checkout and does not imply a one-off trial', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_not_a_credential';
    process.env.STRIPE_BUSINESS_PRICE_ID = 'price_fixture';
    const html = pricingOverview();
    expect(html).toContain('Choose Business');
    expect(html).toContain('Renews monthly. Cancel before renewal.');
    expect(html).not.toContain('Paid signup is not open yet');
});

test('initial pricing does not present live paid checkout until the live readiness gate passes', () => {
    process.env.STRIPE_MODE = 'live';
    process.env.SITE_URL = 'https://canquery.com';
    process.env.SMTP_HOST = 'mail.example.org';
    process.env.SMTP_USER = 'fixture';
    process.env.SMTP_PASSWORD = 'fixture';
    process.env.STRIPE_SECRET_KEY = 'sk_live_fixture_not_a_credential';
    process.env.STRIPE_BUSINESS_PRICE_ID = 'price_fixture';
    process.env.STRIPE_LIVE_READY = 'false';
    expect(pricingOverview()).not.toContain('Choose Business');
    process.env.STRIPE_LIVE_READY = 'true';
    expect(pricingOverview()).toContain('Choose Business');
});

test('documentation availability reflects disabled, compatible and required-key deployments', () => {
    expect(docsOverview()).toContain('Anonymous compatibility is currently available.');
    process.env.API_KEY_REQUIRED_AT = '2999-01-01T00:00:00Z';
    expect(docsOverview()).toContain('The announced key requirement starts at 2999-01-01T00:00:00Z');
    process.env.API_KEY_REQUIRED_AT = '2020-01-01T00:00:00Z';
    const required = docsOverview();
    expect(required).toContain('An API key is required for metered developer routes.');
    expect(required).not.toContain('compatibility is currently available');
    process.env.COMMERCIAL_API_ENABLED = 'false';
    const disabled = docsOverview();
    expect(disabled).toContain('API accounts are unavailable on this deployment');
    expect(disabled).not.toContain('href="/signup"');
});

test('initial reference shares permanent operation anchors and typed parameters with the interactive reference', () => {
    const html = docsOverview();
    for (const item of Object.values(openApi.createOpenApi().paths)) {
        for (const operation of Object.values(item)) expect(html).toContain('id="' + operation.operationId + '"');
    }
    expect(html).toContain('GET /healthz');
    expect(html).not.toContain('GET /api/v1/healthz');
    expect(html).toContain('<th scope="col">Type</th>');
    expect(html).toContain('<td>integer</td>');
    expect(html).toContain('href="/api/v1/openapi.json"');
});

test('initial reference resolves local parameter/schema refs and escapes all dynamic fields', () => {
    const spec = openApi.createOpenApi();
    spec.components.parameters = { unsafe: { name: '<script>name</script>', in: 'query', description: '<img src=x onerror=alert(1)>', schema: { $ref: '#/components/schemas/UnsafeType' } } };
    spec.components.schemas.UnsafeType = { type: 'string" onclick="alert(1)' };
    spec.paths = { '/fixture<img>': { get: { operationId: 'fixture" onclick="alert(1)', summary: '<script>summary</script>', description: '<script>description</script>', parameters: [{ $ref: '#/components/parameters/unsafe' }] } } };
    jest.spyOn(openApi, 'createOpenApi').mockReturnValue(spec);
    const html = docsOverview();
    expect(html).toContain('id="fixture&quot; onclick=&quot;alert(1)"');
    expect(html).toContain('&lt;script&gt;summary&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;name&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
});

test('public pricing and documentation initial HTML require no catalogue reads', async () => {
    const deps = new Proxy({}, { get: (_target, name) => () => { throw new Error('Unexpected catalogue access: ' + String(name)); } });
    for (const route of ['/pricing', '/docs']) {
        const page = await resolvePage(route, deps);
        expect(page.status).toBe(200);
        expect(page.body).toContain('data-cq-seo-snapshot="true"');
        expect(page.body).not.toContain(process.env.BETTER_AUTH_SECRET);
    }
});
