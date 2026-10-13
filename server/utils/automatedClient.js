// Self-identified crawlers, renderers, AI agents and link expanders. Ordinary
// browsers, HTTP libraries and headless test browsers do not match; clients
// that hide their identity are outside the scope of this check.
const SELF_IDENTIFIED_AUTOMATION = new RegExp([
    'bot/', 'googlebot', 'bingbot', 'crawler', 'spider', 'slurp',
    'google-inspectiontool', 'googleother', 'mediapartners-google', 'adsbot-google', 'storebot-google',
    'feedfetcher', 'bingpreview', 'facebookexternalhit', 'meta-external', 'slackbot', 'telegrambot',
    'chatgpt-user', 'perplexity-user', 'claude-user', 'claude-web', 'anthropic-ai', 'petalbot', 'ia_archiver'
].map(token => token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'i');

function isAutomatedClient(userAgent) {
    return typeof userAgent === 'string' && SELF_IDENTIFIED_AUTOMATION.test(userAgent);
}

module.exports = { isAutomatedClient };
