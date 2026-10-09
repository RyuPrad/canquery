const fs = require('node:fs');
const path = require('node:path');
const { classifyRoute } = require('./seoMeta');

const ROUTE_MODULES = Object.freeze({
    datasets: 'DatasetsPage', dataset: 'DatasetPage', resource: 'ResourcePage',
    organizations: 'OrganizationsPage', organization: 'OrganizationPage',
    places: 'PlacesPage', place: 'PlacePage', insights: 'InsightsPage',
    docs: 'DocsPage', privacy: 'PrivacyPage', faq: 'FaqPage', about: 'AboutPage', blog: 'BlogPage',
    pricing:'PricingPage',account:'AccountPage',terms:'TermsPage',login:'AuthPage',signup:'AuthPage',
    'forgot-password':'AuthPage','reset-password':'AuthPage'
});
let cachedDirectory;
let cachedManifest;

function loadManifest(distDir) {
    if (cachedDirectory !== distDir) {
        let manifest = {};
        try {
            manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'asset-manifest.json'), 'utf8'));
        } catch {
            // Older retained releases and development fixtures have no manifest.
            // Dynamic imports still work without this delivery optimization.
        }
        cachedManifest = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {};
        cachedDirectory = distDir;
    }
    return cachedManifest;
}

function safeAsset(file) {
    return typeof file === 'string' && /^assets\/[A-Za-z0-9_./-]+$/.test(file) &&
        !file.split('/').some(part => part === '.' || part === '..');
}

function routeAssets(requestTarget, manifest) {
    const pathname = requestTarget.split('?')[0];
    const type = /^\/(?:fr\/)?blog(?:\/[^/]+)?\/?$/.test(pathname) ? 'blog' : classifyRoute(pathname).type;
    const moduleName = ROUTE_MODULES[type];
    if (!moduleName) return [];
    const seen = new Set();
    const assets = new Map();
    function visit(key) {
        if (seen.has(key)) return;
        seen.add(key);
        const chunk = manifest[key];
        if (!chunk || typeof chunk !== 'object') return;
        if (safeAsset(chunk.file) && chunk.file.endsWith('.js')) assets.set(chunk.file, 'modulepreload');
        for (const css of Array.isArray(chunk.css) ? chunk.css : []) {
            if (safeAsset(css) && css.endsWith('.css')) assets.set(css, 'stylesheet');
        }
        for (const dependency of Array.isArray(chunk.imports) ? chunk.imports : []) visit(dependency);
        // dynamicImports are intentionally excluded: maps/charts load on demand.
    }
    visit('src/pages/' + moduleName + '.jsx');
    return Array.from(assets, ([file, rel]) => ({ file, rel }));
}

function injectRouteAssets(template, requestTarget, distDir) {
    const tags = routeAssets(requestTarget, loadManifest(distDir))
        .filter(({ file }) => !template.includes('href="/' + file + '"') && !template.includes('src="/' + file + '"'))
        .map(({ file, rel }) => '<link rel="' + rel + '" crossorigin href="/' + file + '" />');
    return tags.length ? template.replace('</head>', tags.join('\n') + '\n</head>') : template;
}

module.exports = { routeAssets, injectRouteAssets };
