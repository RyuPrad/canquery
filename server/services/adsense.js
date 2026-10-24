const crypto = require('node:crypto');
const helmet = require('helmet');
const { CSP_DIRECTIVES } = require('../config/contentSecurityPolicy');

// Google AdSense on public pages. Off unless ADSENSE_CLIENT names a publisher
// ("ca-pub-" and 16 digits). It is read on each request, like the analytics
// website id; a malformed value stops startup (app.js) instead of quietly
// leaving ads off.
const CLIENT_RE = /^ca-pub-\d{16}$/;
const LOADER_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
// Google's certification authority id in the ads.txt line AdSense gives publishers.
const GOOGLE_SELLER_ID = 'f08c47fec0942fa0';
// The built index.html's own scripts and modulepreloads carry this until a
// request replaces it, before any catalogue text is added to the page.
const NONCE_PLACEHOLDER = '__CANQUERY_CSP_NONCE__';

function adsenseClient(value = process.env.ADSENSE_CLIENT) {
    const client = (value || '').trim();
    if (!client) return null;
    if (!CLIENT_RE.test(client)) throw new Error('ADSENSE_CLIENT must be "ca-pub-" followed by 16 digits');
    return client;
}

function adsTxtLine(client) {
    return 'google.com, ' + client.replace(/^ca-/, '') + ', DIRECT, ' + GOOGLE_SELLER_ID;
}

function createNonce() {
    return crypto.randomBytes(16).toString('base64');
}

// AdSense supports only a nonce-based policy with 'strict-dynamic': its code
// loads more scripts, frames, images and requests from Google hosts that
// change over time (support.google.com/adsense/answer/16283098). The fallbacks
// after 'strict-dynamic' only apply in browsers without it. Every other
// directive keeps the site-wide policy, including worker-src for the maps.
function adPagePolicy(nonce) {
    const directives = { ...helmet.contentSecurityPolicy.getDefaultDirectives(), ...CSP_DIRECTIVES };
    directives['script-src'] = ["'nonce-" + nonce + "'", "'strict-dynamic'", "'unsafe-inline'", "'unsafe-eval'", 'https:', 'http:'];
    directives['frame-src'] = ['https:'];
    directives['img-src'] = [...directives['img-src'], 'https:'];
    directives['connect-src'] = [...directives['connect-src'], 'https:'];
    return Object.entries(directives).map(([name, values]) => [name, ...values].join(' ')).join(';');
}

// Give the static template's scripts and modulepreloads the nonce placeholder.
// Only the built index.html passes through here; nothing that comes from the
// catalogue is ever marked.
function markTemplateNonces(template) {
    return template
        .replace(/<script\b/g, '<script nonce="' + NONCE_PLACEHOLDER + '"')
        .replace(/<link\b(?=[^>]*\brel="modulepreload")/g, '<link nonce="' + NONCE_PLACEHOLDER + '"');
}

// The account meta goes on every page; ad pages also get the nonce for Vite's
// preload helper (it reads meta[property=csp-nonce]) and Google's loader.
function adsTags(client, nonce) {
    const tags = ['<meta name="google-adsense-account" content="' + client + '" />'];
    if (nonce) {
        tags.push('<meta property="csp-nonce" nonce="' + nonce + '" />',
            '<script async src="' + LOADER_URL + '?client=' + client + '" crossorigin="anonymous" nonce="' + nonce + '"></script>');
    }
    return tags.join('\n    ');
}

// GET /ads.txt - the authorized-seller line AdSense checks; absent when ads are off.
function adsTxt(_req, res, next) {
    const client = adsenseClient();
    if (!client) return next();
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(adsTxtLine(client) + '\n');
}

module.exports = {
    NONCE_PLACEHOLDER, adsenseClient, adsTxtLine, createNonce, adPagePolicy, markTemplateNonces, adsTags, adsTxt
};
