const snapshot = require('../services/seoSnapshot');
const { listArticles } = require('../services/blogContent');
const { escapeHtml } = require('../services/seoMeta');

describe('server-rendered crawl snapshots', () => {
    it('scopes analytics privacy promises and discloses delivery and backups without JavaScript', () => {
        const html = snapshot.staticSnapshot('privacy');
        expect(html).toContain('Product analytics do not store raw network addresses.');
        expect(html).toContain('Account and password pages do not load analytics.');
        expect(html).toContain('Cloudflare process request information');
        expect(html).toContain('Browser analytics opt-outs do not prevent this necessary request processing.');
        expect(html).toContain('private Cloudflare R2 storage');
        expect(html).toContain('Data removed from the live service may remain in a retained backup');
        expect(html).not.toContain('No stored raw network addresses.');
    });

    it('renders the homepage explanation and first three published guides in catalogue order', () => {
        const html = snapshot.staticSnapshot('home');
        const guides = listArticles({ lang: 'en' });
        expect(html.match(/<h1>/g)).toHaveLength(1);
        expect(html).toContain('<h1>Search Canadian open data</h1>');
        expect(html).toContain('<h2>How CanQuery works</h2>');
        expect(html).toContain('prepare eligible CSV and Excel files as tables');
        expect(html).toContain('explore supported maps');
        expect(html).toContain('export up to 10,000 rows as CSV');
        expect(html.match(/href="\/blog\//g)).toHaveLength(3);
        guides.slice(0, 3).forEach((guide, index) => {
            expect(html).toContain('href="' + guide.path + '">' + escapeHtml(guide.title) + '</a>');
            expect(html).toContain(escapeHtml(guide.description));
            if (index) expect(html.indexOf(guide.path)).toBeGreaterThan(html.indexOf(guides[index - 1].path));
        });
        guides.slice(3).forEach(guide => expect(html).not.toContain(guide.path));
        for (const path of ['/datasets', '/places', '/blog', '/organizations', '/insights', '/docs']) {
            expect(html).toContain('href="' + path + '"');
        }
    });

    it('escapes guide paths, titles and summaries in the homepage snapshot', () => {
        jest.isolateModules(() => {
            const content = require('../services/blogContent');
            const spy = jest.spyOn(content, 'listArticles').mockReturnValue([{
                path: '/blog/safe?term="&other=1',
                title: 'A "quoted" title & details',
                description: '<script>bad()</script> Safe <em>summary</em> & details.'
            }]);
            try {
                const html = require('../services/seoSnapshot').staticSnapshot('home');
                expect(spy).toHaveBeenCalledWith({ lang: 'en' });
                expect(html).toContain('href="/blog/safe?term=&quot;&amp;other=1"');
                expect(html).toContain('A &quot;quoted&quot; title &amp; details');
                expect(html).toContain('Safe summary &amp; details.');
                expect(html).not.toContain('<script>');
                expect(html).not.toContain('<em>');
            } finally { spy.mockRestore(); }
        });
    });

    it('links pilot places to their guide without adding unrelated guides', () => {
        expect(snapshot.placeSnapshot({ id: 'p1', slug: 'oshawa-on', name_en: 'Oshawa' }, []))
            .toContain('href="/blog/oshawa-parks-map"');
        expect(snapshot.placeSnapshot({ id: 'p2', name_en: 'Elsewhere' }, []))
            .not.toContain('href="/blog/');
    });
    it('escapes catalogue text and bounds linked resources', () => {
        const resources = Array.from({ length: 30 }, (_, index) => ({
            id: 'r' + index,
            name_en: index === 0 ? '<img src=x onerror=alert(1)>Roads' : 'Resource ' + index,
            format: 'CSV', size_bytes: 100
        }));
        const html = snapshot.datasetSnapshot({
            id: 'd1', name: 'roads',
            title_en: '<script>bad()</script>Road network',
            notes_en: '<p>Public &amp; maintained roads.</p>',
            org_name: 'city-works', org_title_en: 'City <Works>',
            places: [{ slug: 'example-on', name_en: 'Example' }]
        }, resources);
        expect(html).toContain('<h1>Road network</h1>');
        expect(html).toContain('Public &amp; maintained roads.');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect((html.match(/href="\/resources\//g) || [])).toHaveLength(12);
        expect(html).toContain('href="/organizations/city-works"');
        expect(html).toContain('href="/places/example-on"');
    });

    it('renders one semantic h1 and canonical internal links for organizations', () => {
        const html = snapshot.organizationSnapshot({
            id: 'o1', name: 'city-works', title_en: 'City Works', dataset_count: 2,
            queryable_dataset_count: 1, mappable_dataset_count: 1,
            place_id: 'p1', place_slug: 'example-on', place_name_en: 'Example'
        }, [
            { id: 'd1', name: 'roads', title_en: 'Roads' },
            ...Array.from({ length: 20 }, (_, i) => ({ id: 'd' + i, name: 'parks' + i, title_en: 'Parks' }))
        ]);
        expect((html.match(/<h1>/g) || [])).toHaveLength(1);
        expect(html).toContain('href="/datasets/roads"');
        expect(html).toContain('href="/places/example-on"');
        expect((html.match(/href="\/datasets\//g) || [])).toHaveLength(12);
    });
});
