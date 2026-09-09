const snapshot = require('../services/seoSnapshot');

describe('server-rendered crawl snapshots', () => {
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
