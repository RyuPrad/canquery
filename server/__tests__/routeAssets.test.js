const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeAssets, injectRouteAssets } = require('../services/routeAssets');

const manifest = {
    'src/pages/ResourcePage.jsx': { file: 'assets/resource-a.js', imports: ['shared'], dynamicImports: ['map'] },
    'src/pages/BlogPage.jsx': { file: 'assets/blog-a.js', imports: ['shared'] },
    'src/pages/FaqPage.jsx': { file: 'assets/faq-a.js', imports: ['shared'] },
    'src/pages/AboutPage.jsx': { file: 'assets/about-a.js', imports: ['shared'] },
    shared: { file: 'assets/shared-a.js', css: ['assets/shared-a.css'], imports: ['shared'] },
    map: { file: 'assets/map-a.js' }
};

test('preloads only the requested route and recursive static dependencies', () => {
    expect(routeAssets('/resources/r1?view=table', manifest)).toEqual([
        { file: 'assets/resource-a.js', rel: 'modulepreload' },
        { file: 'assets/shared-a.js', rel: 'modulepreload' },
        { file: 'assets/shared-a.css', rel: 'stylesheet' }
    ]);
    expect(routeAssets('/', manifest)).toEqual([]);
    expect(routeAssets('/missing', manifest)).toEqual([]);
    expect(routeAssets('/fr/blog/example', manifest)[0].file).toBe('assets/blog-a.js');
});

test('ignores missing or unsafe manifest assets', () => {
    expect(routeAssets('/datasets', manifest)).toEqual([]);
    expect(routeAssets('/resources/r1', {
        'src/pages/ResourcePage.jsx': { file: 'https://example.com/x.js', css: ['assets/../evil.css', 'assets/"bad.css'] }
    })).toEqual([]);
});

test.each(['faq', 'about'])('preloads only the %s information page and its shared dependencies', page => {
    expect(routeAssets('/' + page + '/?from=footer', manifest)).toEqual([
        { file: 'assets/' + page + '-a.js', rel: 'modulepreload' },
        { file: 'assets/shared-a.js', rel: 'modulepreload' },
        { file: 'assets/shared-a.css', rel: 'stylesheet' }
    ]);
});

test('injects outside SEO ownership and does not duplicate existing asset tags', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-assets-'));
    try {
        fs.writeFileSync(path.join(dir, 'asset-manifest.json'), JSON.stringify(manifest));
        const html = injectRouteAssets('<head><!-- seo:start --><!-- seo:end --><link href="/assets/shared-a.js" /></head>', '/resources/r1', dir);
        expect(html).toContain('<!-- seo:end -->');
        expect(html.match(/\/assets\/shared-a.js/g)).toHaveLength(1);
        expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/resource-a.js" />');
        expect(html).not.toContain('map-a.js');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('remains compatible with a previous build without a manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-assets-old-'));
    try { expect(injectRouteAssets('<head></head>', '/resources/r1', dir)).toBe('<head></head>'); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
