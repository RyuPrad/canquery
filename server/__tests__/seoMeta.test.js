const seo = require('../services/seoMeta');

describe('seoMeta - route classification', () => {
    it('classifies the known SPA routes', () => {
        expect(seo.classifyRoute('/')).toEqual({ type: 'home' });
        expect(seo.classifyRoute('/datasets/water-quality')).toEqual({ type: 'dataset', id: 'water-quality' });
        expect(seo.classifyRoute('/resources/abc-123')).toEqual({ type: 'resource', id: 'abc-123' });
        expect(seo.classifyRoute('/insights')).toEqual({ type: 'insights' });
        expect(seo.classifyRoute('/organizations')).toEqual({ type: 'organizations' });
        expect(seo.classifyRoute('/docs')).toEqual({ type: 'docs' });
    });

    it('ignores query strings and trailing slashes', () => {
        expect(seo.classifyRoute('/datasets/x?highlight=r1')).toEqual({ type: 'dataset', id: 'x' });
        expect(seo.classifyRoute('/insights/')).toEqual({ type: 'insights' });
    });

    it('treats anything else as other', () => {
        expect(seo.classifyRoute('/nope/deep')).toEqual({ type: 'other' });
    });
});

describe('seoMeta - JSON-LD embedding safety', () => {
    it('cannot break out of the script element', () => {
        const out = seo.jsonLdScript({ x: 'evil </script><!-- y' });
        const inner = out.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
        expect(inner).not.toContain('</script>');
        expect(inner).not.toContain('<!--');
        expect(inner).toContain('\\u003c');
    });

    it('preserves ordinary spaces', () => {
        expect(seo.jsonLdScript({ x: 'hello world' })).toContain('hello world');
    });
});

describe('seoMeta - dataset meta + JSON-LD', () => {
    const dataset = {
        id: 'd1',
        name: 'water-quality',
        title_en: 'Water Quality',
        title_fr: 'Qualite de l eau',
        notes_en: '  Lake and river measurements.  ',
        notes_fr: null,
        org_title_en: 'Environment Canada',
        org_title_fr: null,
        keywords_en: ['water', 'lakes', 'water'],
        keywords_fr: ['eau'],
        metadata_modified: '2026-01-02T10:00:00Z',
    };
    const resources = [
        { id: 'r1', url: '/data/x/download/a.csv', format: 'CSV', name_en: '2025 data', name_fr: null },
        { id: 'r2', url: 'https://example.com/b.xlsx', format: 'XLSX', name_en: null, name_fr: null },
    ];

    it('builds an English-default title and slug canonical', () => {
        const meta = seo.datasetMeta(dataset, resources);
        expect(meta.title).toBe('Water Quality - canquery');
        expect(meta.canonical).toBe('https://canquery.com/datasets/water-quality');
        expect(meta.description).toBe('Lake and river measurements.');
    });

    it('emits a schema.org Dataset with licence, keywords and absolute distributions', () => {
        const meta = seo.datasetMeta(dataset, resources);
        const ld = meta.jsonLd[0];
        expect(ld['@type']).toBe('Dataset');
        expect(ld.url).toBe('https://canquery.com/datasets/water-quality');
        expect(ld.identifier).toBe('d1');
        expect(ld.license).toContain('open-government-licence-canada');
        expect(ld.sameAs).toBe('https://open.canada.ca/data/en/dataset/d1');
        expect(ld.keywords).toEqual(['water', 'lakes', 'eau']); // deduped, both langs
        expect(ld.dateModified).toBe('2026-01-02T10:00:00.000Z');
        expect(ld.creator).toEqual({ '@type': 'GovernmentOrganization', name: 'Environment Canada' });
        // relative URL resolved to absolute against the upstream origin
        expect(ld.distribution[0].contentUrl).toBe('https://open.canada.ca/data/x/download/a.csv');
        expect(ld.distribution[1].contentUrl).toBe('https://example.com/b.xlsx');
    });

    it('falls back to the French title when English is missing', () => {
        const meta = seo.datasetMeta({ ...dataset, title_en: null }, []);
        expect(meta.title).toBe('Qualite de l eau - canquery');
    });

    it('synthesizes a description when notes are empty', () => {
        const meta = seo.datasetMeta({ ...dataset, notes_en: null, notes_fr: null }, []);
        expect(meta.description).toContain('Water Quality');
        expect(meta.description).toContain('Environment Canada');
    });
});

describe('seoMeta - site + static meta', () => {
    it('home meta carries a WebSite SearchAction and an Organization', () => {
        const meta = seo.homeMeta();
        const types = meta.jsonLd.map((o) => o['@type']);
        expect(types).toContain('WebSite');
        expect(types).toContain('Organization');
        const website = meta.jsonLd.find((o) => o['@type'] === 'WebSite');
        expect(website.potentialAction['@type']).toBe('SearchAction');
        expect(website.potentialAction.target.urlTemplate).toContain('{search_term_string}');
    });

    it('static sections get a title and a clean canonical', () => {
        expect(seo.staticMeta('docs').canonical).toBe('https://canquery.com/docs');
        expect(seo.staticMeta('docs').title).toContain('API documentation');
        expect(seo.staticMeta('insights').title).toContain('Top 100');
    });

    it('unknown routes are marked noindex', () => {
        const meta = seo.staticMeta('other', '/nope');
        expect(meta.noindex).toBe(true);
        expect(meta.canonical).toBe('https://canquery.com/nope');
    });
});

describe('seoMeta - renderHtml injection', () => {
    const template =
        '<html><head>\n    <!-- seo:start -->\n    <title>default</title>\n    <!-- seo:end -->\n  </head><body></body></html>';

    it('replaces the managed block with escaped tags + JSON-LD', () => {
        const html = seo.renderHtml(template, seo.datasetMeta({ id: 'd', name: 'n', title_en: 'A & B <c>', notes_en: 'x' }, []));
        expect(html).toContain('<title>A &amp; B &lt;c&gt; - canquery</title>');
        expect(html).toContain('<link rel="canonical" href="https://canquery.com/datasets/n" />');
        expect(html).toContain('application/ld+json');
        expect(html).not.toContain('<title>default</title>');
    });

    it('adds a robots noindex tag when requested', () => {
        const html = seo.renderHtml(template, seo.notFoundMeta('/x'));
        expect(html).toContain('name="robots" content="noindex');
    });

    it('returns the template untouched when the markers are absent', () => {
        const plain = '<html><head><title>x</title></head></html>';
        expect(seo.renderHtml(plain, seo.homeMeta())).toBe(plain);
    });
});
