const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const request = require('supertest');
const { readArticles, listArticles, getArticle, permittedUrl } = require('../services/blogContent');
const { resolvePage, serveSpa } = require('../controllers/spaController');
const { renderHtml } = require('../services/seoMeta');
const app = require('../app');
const template = '<!doctype html><html lang="en"><head><!-- seo:start --><!-- seo:end --></head><body><div id="root"></div></body></html>';

test('publishes six paired guides with verified resource links', () => {
    expect(readArticles()).toHaveLength(12);
    expect(listArticles()).toHaveLength(6);
    expect(listArticles({ lang: 'fr', place: 'oshawa-on' })).toHaveLength(1);
    for (const lang of ['en', 'fr']) for (const article of listArticles({ lang })) {
        const full = getArticle(lang, article.slug);
        expect(full.bodyHtml).toContain('<h2>');
        expect(full.bodyHtml.length).toBeGreaterThan(2500);
        expect(full.bodyHtml).toContain('/resources/');
        expect(full.translations.en).toMatch(/^\/blog\//);
        expect(full.translations.fr).toMatch(/^\/fr\/blog\//);
        expect(article.bodyHtml).toBeUndefined();
    }
});

test.each(['en', 'fr'])('renders complete %s articles and metadata without any catalogue query', async lang => {
    const articles = listArticles({ lang });
    const unavailable = new Proxy({}, { get() { throw new Error('Catalogue must not be accessed'); } });
    for (const article of articles) {
        const page = await resolvePage(article.path, unavailable);
        const html = renderHtml(template, page.meta, page.body);
        expect(page.status).toBe(200);
        expect(html).toContain('<html lang="' + lang + '">');
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(html).toContain(getArticle(lang, article.slug).bodyHtml);
        expect(page.meta.alternates).toHaveProperty('fr-CA');
        expect(page.meta.jsonLd.find(item => item['@type'] === 'BlogPosting')).toMatchObject({
            author: { '@type': 'Organization', name: 'CanQuery' }, datePublished: article.published
        });
    }
});

test('serves article APIs, geographic listing, real 404s and the blog sitemap', async () => {
    const article = listArticles()[0];
    expect((await request(app).get('/api/v1/blog?lang=fr&place=montreal-qc')).body.data).toHaveLength(1);
    const result = await request(app).get('/api/v1/blog/en/' + article.slug);
    expect(result.status).toBe(200);
    expect(result.body.meta.license).toBeNull();
    expect(result.body.data.bodyHtml).toContain('<h2>');
    expect((await request(app).get('/api/v1/blog?lang=de')).status).toBe(400);
    expect((await request(app).get('/api/v1/blog/en/missing')).status).toBe(404);
    const sitemap = await request(app).get('/sitemap-blog.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.text.match(/<loc>/g)).toHaveLength(14);
    expect(sitemap.text).toContain('/fr/blog/');
});

test('keeps missing article status and canonical redirects correct at the HTTP boundary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-blog-'));
    fs.writeFileSync(path.join(dir, 'index.html'), template);
    try {
        const server = express();
        server.use(serveSpa(dir));
        const missing = await request(server).get('/fr/blog/missing');
        expect(missing.status).toBe(404);
        expect(missing.text).toContain('noindex');
        const redirect = await request(server).get('/blog/?from=test');
        expect(redirect.status).toBe(301);
        expect(redirect.headers.location).toBe('/blog?from=test');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rejects bad manifests, missing translations and external images; escapes authored HTML', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-blog-content-'));
    fs.cpSync(path.join(__dirname, '../../content/blog'), root, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'index.json')));
    const write = value => fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(value));
    try {
        write([...manifest, manifest[0]]);
        expect(() => readArticles(root)).toThrow(/Duplicate/);
        const invalid = JSON.parse(JSON.stringify(manifest));
        delete invalid[0].editions.fr;
        write(invalid);
        expect(() => readArticles(root)).toThrow();
        write(manifest);
        const file = path.join(root, manifest[0].id + '.en.md');
        fs.writeFileSync(file, '![map](https://example.test/map.png)');
        expect(() => readArticles(root)).toThrow(/self-hosted/);
        fs.writeFileSync(file, '<script>alert(1)</script>');
        expect(readArticles(root)[0].bodyHtml).toContain('&lt;script&gt;');
        expect(permittedUrl('javascript:alert(1)')).toBe(false);
        expect(permittedUrl('//example.test')).toBe(false);
        expect(permittedUrl('/\\example.test')).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('excludes draft editions from listings, pages and sitemaps', () => {
    const read = fs.readFileSync;
    const manifestPath = path.join(__dirname, '../../content/blog/index.json');
    const manifest = JSON.parse(read(manifestPath, 'utf8'));
    manifest[0].status = 'draft';
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) =>
        file === manifestPath ? JSON.stringify(manifest) : read(file, ...args));
    try {
        jest.isolateModules(() => {
            const content = require('../services/blogContent');
            const { resolveBlogPage } = require('../services/blogPresentation');
            const { sitemapBlog } = require('../controllers/sitemapController');
            const res = { set: jest.fn(), send: jest.fn() };
            sitemapBlog({}, res);
            for (const lang of ['en', 'fr']) {
                const slug = manifest[0].editions[lang].slug;
                const articlePath = (lang === 'fr' ? '/fr' : '') + '/blog/' + slug;
                expect(content.listArticles({ lang })).toHaveLength(5);
                expect(content.getArticle(lang, slug)).toBeNull();
                expect(resolveBlogPage(articlePath).status).toBe(404);
                expect(res.send.mock.calls[0][0]).not.toContain(articlePath);
            }
        });
    } finally { spy.mockRestore(); }
});

test('national guides support localized resource links and dataset discovery without fictional places', async () => {
    const dataset = '90fed587-1364-4f33-a9ee-208181dc0b97';
    const en = listArticles({ dataset })[0];
    const fr = listArticles({ dataset, lang: 'fr' })[0];
    expect(en.place).toBeUndefined();
    expect(en.explore).toContain('4ee7a4e0-ffc3-47af-94e7-30929d1eeb67');
    expect(fr.explore).toContain('8c205edb-9a82-468e-9aa4-b82266cbaad6');
    const html = (await resolvePage(fr.path)).body;
    expect(html).not.toContain('/places/');
    const download = listArticles({ dataset: '4f8575f0-918e-41bb-bcde-044d04caaf31', lang: 'fr' })[0];
    expect(download.view).toBe('download');
    expect((await resolvePage(download.path)).body).toContain('Consulter les détails du téléchargement');
    const response = await request(app).get('/api/v1/blog').query({ dataset, lang: 'fr' });
    expect(response.body.data.map(item => item.id)).toEqual([fr.id]);
    expect((await request(app).get('/api/v1/blog?dataset=a&dataset=b')).status).toBe(400);
    expect(listArticles({ dataset: 'does-not-exist' })).toEqual([]);
    expect(listArticles({ dataset: 'toronto-open-data-building-permits-active-permits' })).toEqual(
        listArticles({ dataset: 'ckan-toronto-open-data-dataset-108c2bd1-6945-46f6-af92-02f5658ee7f7' }));
    const snapshots = require('../services/seoSnapshot');
    for (const html of [snapshots.datasetSnapshot({ id: dataset }, []), snapshots.resourceSnapshot({ id: 'r', dataset_id: dataset })]) {
        expect(html).toContain(en.path);
        expect(html).not.toContain(download.path);
    }
});
