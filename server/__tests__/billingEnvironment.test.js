jest.mock('stripe', () => jest.fn());
jest.mock('../db/pool', () => ({ query: jest.fn() }));

const Stripe = require('stripe');
const { verifyEnvironment } = require('../services/billingService');
const { BUSINESS_PRICE } = require('../services/commercialConfig');
const savedEnv = { ...process.env };
let stripe;
let db;

beforeEach(() => {
    process.env = { ...savedEnv, COMMERCIAL_API_ENABLED: 'true', STRIPE_MODE: 'sandbox',
        STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_BUSINESS_PRICE_ID: 'price_business_nine',
        BETTER_AUTH_SECRET: 'fixture-auth-secret-with-more-than-32-characters', SITE_URL: 'https://canquery.example',
        STRIPE_TAX_ENABLED: 'false', STRIPE_TAX_REVIEWED: 'false', STRIPE_TAX_REGISTRATION_CONFIRMED: 'false' };
    stripe = { prices: { retrieve: jest.fn().mockResolvedValue({ active: true, livemode: false,
        currency: 'cad', unit_amount: 900, recurring: { interval: 'month', interval_count: 1 } }) },
    tax: { settings: { retrieve: jest.fn() }, registrations: { list: jest.fn() } } };
    Stripe.mockReset().mockReturnValue(stripe);
    db = { query: jest.fn().mockImplementation(async () => ({ rows: [{ mode: process.env.STRIPE_MODE }] })) };
});
afterAll(() => { process.env = savedEnv; });

test('accepts only the reviewed CAD9 monthly price while preserving disabled tax collection', async () => {
    expect(BUSINESS_PRICE).toEqual({ currency: 'cad', amount: 900, interval: 'month' });
    await expect(verifyEnvironment(db)).resolves.toBeUndefined();
    expect(stripe.prices.retrieve).toHaveBeenCalledWith('price_business_nine');
    expect(stripe.tax.settings.retrieve).not.toHaveBeenCalled();
    expect(stripe.tax.registrations.list).not.toHaveBeenCalled();
});

test.each([
    ['former CAD49 amount', { unit_amount: 4900 }],
    ['different amount', { unit_amount: 901 }],
    ['decimal-only amount', { unit_amount: null, unit_amount_decimal: '900' }],
    ['different currency', { currency: 'usd' }],
    ['inactive price', { active: false }],
    ['wrong mode', { livemode: true }],
    ['annual recurrence', { recurring: { interval: 'year', interval_count: 1 } }],
    ['multiple months', { recurring: { interval: 'month', interval_count: 2 } }],
    ['one-time price', { recurring: null }]
])('rejects %s before opening the API listener', async (_name, changes) => {
    stripe.prices.retrieve.mockResolvedValue({ active: true, livemode: false,
        currency: 'cad', unit_amount: 900, recurring: { interval: 'month', interval_count: 1 }, ...changes });
    await expect(verifyEnvironment(db)).rejects.toThrow('Business price does not match the reviewed plan');
});

test('live launch still requires a recorded tax review when automatic collection is disabled', async () => {
    Object.assign(process.env, { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_LIVE_READY: 'true',
        SMTP_HOST: 'mail.example', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture', SMTP_REQUIRE_TLS: 'true' });
    stripe.prices.retrieve.mockResolvedValue({ active: true, livemode: true, currency: 'cad', unit_amount: 900,
        recurring: { interval: 'month', interval_count: 1 } });
    await expect(verifyEnvironment(db)).rejects.toThrow('Live tax setup must be reviewed');
    process.env.STRIPE_TAX_REVIEWED = 'true';
    await expect(verifyEnvironment(db)).resolves.toBeUndefined();
    expect(stripe.tax.registrations.list).not.toHaveBeenCalled();
});

test('enabling automatic tax retains both confirmation and active-registration guards', async () => {
    process.env.STRIPE_TAX_ENABLED = 'true';
    await expect(verifyEnvironment(db)).rejects.toThrow('Tax registration confirmation required');
    process.env.STRIPE_TAX_REGISTRATION_CONFIRMED = 'true';
    stripe.tax.settings.retrieve.mockResolvedValue({ status: 'active' });
    stripe.tax.registrations.list.mockResolvedValue({ data: [] });
    await expect(verifyEnvironment(db)).rejects.toThrow('Stripe Tax is not ready to collect');
    expect(stripe.tax.registrations.list).toHaveBeenCalledWith({ status: 'active', limit: 1 });
    stripe.tax.registrations.list.mockResolvedValue({ data: [{ status: 'active' }] });
    stripe.tax.settings.retrieve.mockResolvedValue({ status: 'pending' });
    await expect(verifyEnvironment(db)).rejects.toThrow('Stripe Tax is not ready to collect');
    stripe.tax.settings.retrieve.mockResolvedValue({ status: 'active' });
    await expect(verifyEnvironment(db)).resolves.toBeUndefined();
});

test('a database pinned to the other billing environment remains unusable', async () => {
    db.query.mockResolvedValue({ rows: [{ mode: 'live' }] });
    await expect(verifyEnvironment(db)).rejects.toThrow('Billing environment mismatch');
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
});
