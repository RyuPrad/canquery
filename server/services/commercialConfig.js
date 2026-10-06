const PLANS = Object.freeze({
    free: { credits: 1000, keys: 1, rate: 30, concurrency: 1 },
    business: { credits: 100000, keys: 5, rate: 300, concurrency: 2 }
});
function config() {
    const enabled = process.env.COMMERCIAL_API_ENABLED === 'true';
    const mode = process.env.STRIPE_MODE || 'sandbox';
    const origin = (process.env.SITE_URL || 'https://canquery.com').replace(/\/$/, '');
    const parsedOrigin = new URL(origin);
    if (!['http:','https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin || parsedOrigin.username || parsedOrigin.password) {
        throw new Error('SITE_URL must be an HTTP(S) origin without credentials or a path');
    }
    const sunset = process.env.API_KEY_REQUIRED_AT || null;
    if (!['sandbox', 'live'].includes(mode)) throw new Error('Invalid STRIPE_MODE');
    if (sunset && !Number.isFinite(Date.parse(sunset))) throw new Error('Invalid API_KEY_REQUIRED_AT');
    if (enabled && (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)) {
        throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
    }
    const checkout = enabled && Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_BUSINESS_PRICE_ID)
        && (mode === 'sandbox' || process.env.STRIPE_LIVE_READY === 'true');
    if (process.env.STRIPE_SECRET_KEY && !new RegExp(`^[sr]k_${mode === 'live' ? 'live' : 'test'}_`).test(process.env.STRIPE_SECRET_KEY)) {
        throw new Error('Stripe credential does not match STRIPE_MODE');
    }
    if (mode === 'live' && enabled && !origin.startsWith('https://')) throw new Error('Live accounts require HTTPS');
    if (mode === 'live' && enabled && process.env.SMTP_REQUIRE_TLS === 'false') throw new Error('Live account mail requires TLS');
    if (mode === 'live' && enabled && !['SMTP_HOST','SMTP_USER','SMTP_PASSWORD'].every(name=>process.env[name])) {
        throw new Error('Live account mail requires authenticated SMTP configuration');
    }
    return { enabled, mode, origin, sunset, checkout };
}
module.exports = { PLANS, config };
