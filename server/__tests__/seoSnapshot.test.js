const snapshot = require('../services/seoSnapshot');
const { listArticles } = require('../services/blogContent');
const { escapeHtml } = require('../services/seoMeta');

describe('server-rendered crawl snapshots', () => {
    it('renders grouped FAQ disclosures with practical answers and authoritative detail links', () => {
        const html = snapshot.staticSnapshot('faq');
        expect(html.match(/<h1>/g)).toHaveLength(1);
        expect(html).toContain('<h1>Frequently asked questions</h1>');
        expect(html.match(/<details>/g).length).toBeGreaterThanOrEqual(6);
        expect(html.match(/<summary>/g)).toHaveLength(html.match(/<details>/g).length);
        for (const heading of ['Getting started', 'Working with data']) {
            expect(html).toContain('<h2>' + heading + '</h2>');
        }
        expect(html).toContain('A catalogue listing does not guarantee that every file is available');
        expect(html).toContain('Opening catalogue pages or Map does not start table preparation.');
        expect(html).toContain('at most 10,000 rows');
        for (const path of ['/docs', '/privacy']) expect(html).toContain('href="' + path + '"');
    });

    it('explains the project, its creator and the distinction between code and publisher licences', () => {
        const html = snapshot.staticSnapshot('about');
        expect(html.match(/<h1>/g)).toHaveLength(1);
        expect(html).toContain('<h1>About CanQuery</h1>');
        expect(html).toContain('<section><h2>What is CanQuery?</h2><p>CanQuery is a free search engine for Canadian open data.');
        expect(html.indexOf('What is CanQuery?')).toBeLessThan(html.indexOf('Find the data. Keep the context.'));
        expect(html).toContain('not affiliated with the Government of Canada');
        expect(html).toContain('built by @RyuPrad');
        expect(html).toContain('The software licence is separate from the licences that apply to the published data.');
        for (const path of ['/datasets', '/faq', 'https://github.com/RyuPrad', 'https://github.com/RyuPrad/canquery']) {
            expect(html).toContain('href="' + path + '"');
        }
    });

    test.each(['faq', 'about'])('makes support available on %s without JavaScript', type => {
        const html = snapshot.staticSnapshot(type);
        expect(html).toContain('<h2>Contact support</h2>');
        expect(html).toContain('href="mailto:support@canquery.com">support@canquery.com</a>');
        expect(html).toContain('X-Request-Id');
        expect(html).toContain('Leave out API keys, passwords and sensitive query contents.');
        expect(html).toContain('one existing supported resource and one working query');
    });

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

    it('links pilot places to their guides in both languages without adding unrelated guides', () => {
        const html = snapshot.placeSnapshot({ id: 'p1', slug: 'oshawa-on', name_en: 'Oshawa' }, []);
        expect(html).toContain('href="/blog/oshawa-parks-map"');
        expect(html).toContain('href="/fr/blog/carte-parcs-oshawa"');
        expect(html).toContain('<span>(français)</span>');
        expect(snapshot.placeSnapshot({ id: 'p2', name_en: 'Elsewhere' }, []))
            .not.toContain('href="/blog/');
    });

    it('renders the place hub: lead, facts, sections, the dataset list and nearby places in order', () => {
        const place = { id: 'sgc-csd-3518013', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa', type_en: 'City',
            dataset_count: 200, direct_dataset_count: 20, mappable_dataset_count: 150, last_modified: '2026-10-01T12:00:00Z',
            ancestors: [{ id: 'ca', slug: 'canada', kind: 'country', name_en: 'Canada' }, { id: 'on', slug: 'ontario', kind: 'province', name_en: 'Ontario' },
                { id: 'sgc-cd-3518', slug: 'durham-on', kind: 'region', name_en: 'Durham' }, { id: 'sgc-csd-3518013', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa' }],
            children: [] };
        const hub = {
            facets: { total: 200, facets: { level: [{ value: 'municipal', count: 20 }, { value: 'provincial', count: 180 }],
                access: [{ value: 'queryable', count: 40 }, { value: 'mappable', count: 150 }],
                organization: [{ value: 'city-of-oshawa', count: 20 }, { value: 'ontario', count: 180 }], source: [], format: [], keyword: [] } },
            organizations: [{ name: 'city-of-oshawa', title_en: 'City of Oshawa', dataset_count: 20 }],
            sources: [{ id: 'oshawa-hub', name_en: 'Oshawa Open Data', homepage_url: 'https://data.oshawa.ca/', dataset_count: 20, authoritative_dataset_count: 18 },
                { id: 'bad', name_en: 'Bad', homepage_url: 'javascript:alert(1)' }],
            popular: [{ resource_id: 'r1', name_en: 'Parks', hits: 9 }, { resource_id: 'r2', name_en: null, dataset_title_en: 'Roads', hits: 1 }],
            recent: [{ resource_id: 'r3', name_en: 'Trails', format: 'CSV' }],
            siblings: [{ id: 'a', slug: 'ajax-on', name_en: 'Ajax', dataset_count: 430 }]
        };
        const datasets = [{ id: 'd1', name: 'parks', title_en: 'Parks', mappable_count: 1, preview_map_id: 'm1' },
            { id: 'd2', name: 'roads', title_en: 'Roads', mappable_count: 0 }];
        const html = snapshot.placeSnapshot(place, datasets, { page: 1, path: '/places/oshawa-on', items: datasets, hasMore: false }, hub);
        expect(html).toContain('<h1>Oshawa open data</h1>');
        expect(html).toContain('<p data-cq-lead="true">Oshawa (City, Ontario) has 200 open datasets on CanQuery: 20 municipal and 180 provincial. ' +
            '150 have an interactive map and 40 have a live table you can filter, chart and export. They come from 2 publishers. ' +
            'Below: the publishers and official portals, the most used and recently prepared tables, the datasets with maps, every dataset, the guides and nearby places.</p>');
        expect(html).toContain('<dt>With live tables</dt><dd>40</dd>');
        expect(html).toContain('<dt>Publishers</dt><dd>2</dd>');
        expect(html).toContain('<dt>Last catalogue update</dt><dd>2026-10-01</dd>');
        const order = ['<h2>Publishers</h2>', 'href="/organizations/city-of-oshawa">City of Oshawa</a> <span>20 datasets</span>',
            '<h2>Official portals</h2>', 'href="https://data.oshawa.ca/">Oshawa Open Data</a> <span>18 datasets</span>',
            '<h2>Popular tables</h2>', 'href="/resources/r1">Parks</a> <span>9 queries this week</span>', 'href="/resources/r2">Roads</a> <span>1 query this week</span>',
            '<h2>Recently loaded tables</h2>', 'href="/resources/r3">Trails</a> <span>CSV</span>',
            '<h2>Datasets with maps</h2>', 'href="/resources/m1?view=map">Parks</a>',
            '<h2>Datasets</h2>', 'href="/datasets/parks">Parks</a>', 'href="/datasets/roads">Roads</a>',
            '<h2>Nearby places</h2>', 'href="/places/ontario">Ontario</a> <span>Province</span>', 'href="/places/ajax-on">Ajax</a> <span>430 datasets</span>'];
        let position = -1;
        for (const marker of order) {
            const next = html.indexOf(marker);
            expect(next).toBeGreaterThan(position);
            position = next;
        }
        expect(html).not.toContain('javascript:');
        const later = snapshot.placeSnapshot(place, datasets, { page: 2, path: '/places/oshawa-on', items: datasets, hasMore: false }, hub);
        expect(later).toContain('<h1>Oshawa open data (page 2)</h1>');
        expect(later).not.toContain('<h2>Publishers</h2>');
        expect(later).toContain('<h2>Datasets</h2>');
        expect(later).toContain('href="/places/ontario"');
        expect(later).not.toContain('href="/places/ajax-on"');
    });

    it('always lists a place’s children beside its datasets', () => {
        const html = snapshot.placeSnapshot({ id: 'on', slug: 'ontario', kind: 'province', name_en: 'Ontario', dataset_count: 5,
            children: [{ id: 't', slug: 'toronto-on', name_en: 'Toronto', dataset_count: 556 }, { id: 'o', slug: 'oshawa-on', name_en: 'Oshawa', dataset_count: 200 }] },
        [{ id: 'd1', name: 'roads', title_en: 'Roads' }]);
        expect(html).toContain('<h2>Datasets</h2>');
        expect(html).toContain('<h2>Nearby places</h2><ul><li><a href="/places/toronto-on">Toronto</a> <span>556 datasets</span></li>');
        expect(html).toContain('href="/places/oshawa-on">Oshawa</a> <span>200 datasets</span>');
    });

    it('groups the places directory by province, with places outside one first', () => {
        const html = snapshot.staticSnapshot('places', [
            { id: 'ca', slug: 'canada', name_en: 'Canada', kind: 'country', dataset_count: 36000 },
            { id: 'on', slug: 'ontario', name_en: 'Ontario', kind: 'province', province_name_en: 'Ontario', dataset_count: 12000 },
            { id: 't', slug: 'toronto-on', name_en: 'Toronto', kind: 'municipality', province_name_en: 'Ontario', dataset_count: 556 },
            { id: 'm', slug: 'montreal-qc', name_en: 'Montréal', kind: 'municipality', province_name_en: 'Quebec', province_name_fr: 'Québec', dataset_count: 405 }
        ]);
        expect(html.indexOf('<h2>Canada</h2>')).toBeLessThan(html.indexOf('<h2>Ontario</h2>'));
        expect(html.indexOf('<h2>Ontario</h2>')).toBeLessThan(html.indexOf('<h2>Quebec</h2>'));
        expect(html).toContain('<h2>Ontario</h2><ul><li><a href="/places/ontario">Ontario</a> <span>12,000 datasets</span></li><li><a href="/places/toronto-on">Toronto</a> <span>556 datasets</span></li></ul>');
        expect(html).toContain('href="/places/montreal-qc">Montréal</a>');
        expect(html).not.toContain('Featured places');
        expect(html).not.toContain('Explore CanQuery');
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
        expect(html).toContain('<p data-cq-lead="true">Road network is an open dataset from City with 30 files (CSV). ' +
            'On CanQuery you can open 30 CSV or Excel files as tables, filter, chart and export up to 10,000 rows as CSV ' +
            'and follow the original downloads.</p>');
        expect(html).toContain('Public &amp; maintained roads.');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect((html.match(/href="\/resources\//g) || [])).toHaveLength(12);
        expect(html).toContain('href="/organizations/city-works"');
        expect(html).toContain('href="/places/example-on"');
    });

    it('describes access in reader words and never leaks capability codes', () => {
        const ready = snapshot.resourceSnapshot({ id: 'r', name_en: 'Permits', format: 'CSV', url: 'https://example.test/p.csv',
            ingest_status: 'ready', ingested_row_count: 1200, ingested_columns: [{ id: 'a', type: 'TEXT' }, { id: 'b', type: 'TEXT' }] });
        expect(ready).toContain('<dt>Access</dt><dd>Live table (filter, chart, export)</dd>');
        expect(ready).toContain('<dt>Rows</dt><dd>1,200</dd>');
        expect(ready).toContain('<dt>Fields</dt><dd>2</dd>');
        const loadable = snapshot.resourceSnapshot({ id: 'r', name_en: 'Permits', format: 'XLSX', url: 'https://example.test/p.xlsx', map_provider: 'arcgis' });
        expect(loadable).toContain('<dd>Table on demand (prepared when opened) and interactive map</dd>');
        const download = snapshot.resourceSnapshot({ id: 'r', name_en: 'Report', format: 'PDF', url: 'https://example.test/p.pdf' });
        expect(download).toContain('<dd>Original download only</dd>');
        for (const html of [ready, loadable, download]) {
            expect(html).not.toMatch(/<dd>(?:ingestable|file-only|ingested|datastore|mapped)<\/dd>/);
        }
        const dataset = snapshot.datasetSnapshot({ id: 'd', name: 'x', title_en: 'X' }, [{ id: 'r1', name_en: 'Table', format: null, url: 'https://e/t.csv' }]);
        expect(dataset).toContain('<span>Original download only</span>');
    });

    it('offers a download-only file from the dataset page, with its URL validated', () => {
        const dataset = { id: 'd', name: 'reports', title_en: 'Reports' };
        const html = snapshot.datasetSnapshot(dataset, [
            { id: 'r1', name_en: 'Annual report', format: 'PDF', url: 'https://example.test/report.pdf?a=1&b=2' },
            { id: 'r2', name_en: 'Table', format: 'CSV', url: 'https://example.test/table.csv' },
            { id: 'r3', name_en: 'Bad', format: 'PDF', url: 'javascript:alert(1)' },
            { id: 'r4', name_en: 'Secret', format: 'PDF', url: 'https://user:secret@example.test/file.pdf' }
        ]);
        expect(html).toContain('<a href="/resources/r1">Annual report (PDF)</a> <span>PDF</span> · <a href="https://example.test/report.pdf?a=1&amp;b=2">Download PDF</a>');
        expect(html).toContain('<a href="/resources/r2">Table (CSV)</a> <span>CSV</span></li>');
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('user:secret');
        expect((html.match(/Download PDF/g) || [])).toHaveLength(1);
    });

    it('opens every snapshot with one section nav and lists the Top 100 beyond the usual link bound', () => {
        const nav = snapshot.sectionNav();
        expect(nav).toContain('<nav aria-label="CanQuery sections"');
        expect(nav.match(/<li>/g)).toHaveLength(8);
        expect(nav).toContain('<a href="/fr/blog">Guides des données</a>');
        expect(snapshot.staticSnapshot('about').match(/<nav aria-label="CanQuery sections"/g)).toHaveLength(1);
        const items = Array.from({ length: 13 }, (_, i) => ({ rank: i + 1, dataset_id: 'd' + i, dataset_name: i ? 'name-' + i : null,
            title_en: 'Title ' + i, downloads: 1000 - i }));
        const html = snapshot.staticSnapshot('insights', items);
        expect(html).toContain('<h2>Top 100 downloaded datasets</h2>');
        expect((html.match(/href="\/datasets\//g) || [])).toHaveLength(13);
        expect(html).toContain('<a href="/datasets/d0">#1 · Title 0</a> <span>1,000 downloads</span>');
        expect(html).toContain('<a href="/datasets/name-12">#13 · Title 12</a>');
        expect(html).toContain('<h2>Related open data</h2><ul><li><a href="/">Search all datasets</a>');
        expect(snapshot.staticSnapshot('insights', [])).toContain('<h2>Explore CanQuery</h2>');
    });

    it('names later pages in the heading only', () => {
        const dataset = { id: 'd', name: 'x', title_en: 'Roads' };
        const resources = Array.from({ length: 60 }, (_, i) => ({ id: 'r' + i, name_en: 'File ' + i, format: 'CSV' }));
        const { pageSlice } = require('../services/catalogPagination');
        expect(snapshot.datasetSnapshot(dataset, resources, pageSlice(resources.slice(50), 2, '/datasets/x'))).toContain('<h1>Roads (page 2)</h1>');
        expect(snapshot.datasetSnapshot(dataset, resources, pageSlice(resources, 1, '/datasets/x'))).toContain('<h1>Roads</h1>');
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
        // The place sentence outranks the capability counts when the description must shrink.
        expect(html).toContain('<p data-cq-lead="true">City Works publishes 2 open datasets on CanQuery. ' +
            'Part of Example open data. Preview tables, export CSV and follow original downloads.</p>');
        expect(html).toContain('<h2>Datasets</h2>');
        expect(html).toContain('href="/datasets/roads"');
        expect(html).toContain('<h2>Part of</h2><ul><li><a href="/places/example-on">Example open data</a></li></ul>');
        expect((html.match(/href="\/datasets\//g) || [])).toHaveLength(12);
    });
});
