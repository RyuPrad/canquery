// Directives helmet adds to its default Content-Security-Policy (app.js). Ad
// pages build their policy from the same set (services/adsense.js), so the two
// policies cannot drift apart.
const CSP_DIRECTIVES = Object.freeze({
    'img-src': ["'self'", 'data:', 'blob:', 'https://maps-cartes.services.geo.ca'],
    'connect-src': ["'self'", 'https://maps-cartes.services.geo.ca'],
    'worker-src': ["'self'", 'blob:']
});

module.exports = { CSP_DIRECTIVES };
