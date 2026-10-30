const seo = require('../services/seoMeta');

test('makes Markdown descriptions readable without exposing link destinations or executable markup', () => {
    expect(seo.plainText('**Note**: Read [contract history](https://example.test/long-url).\n\n---\n<script>bad()</script>Use `CSV` &amp; tables.'))
        .toBe('Note: Read contract history. Use CSV & tables.');
});

test('keeps the recorded file language, format and map action in long resource snippets', () => {
    const resource = { id: 'r', name_en: 'Long official employer list name '.repeat(20),
        format: 'XLSX', language: ['fr'], ingest_status: 'ready', map_provider: 'arcgis' };
    const meta = seo.resourceMeta(resource);
    expect(meta.title).toContain('(French, XLSX live table and map) - CanQuery');
    expect(meta.title.length).toBeLessThanOrEqual(80);
    expect(meta.title).not.toContain('…');
    expect(meta.description).toMatch(/^Explore the interactive map\./);
    expect(meta.description).toContain('French XLSX table');
    expect(meta.description.length).toBeLessThanOrEqual(160);
});

describe('seoMeta - route classification', () => {
    it('classifies the known SPA routes', () => {
        expect(seo.classifyRoute('/')).toEqual({ type: 'home' });
        expect(seo.classifyRoute('/datasets/water-quality')).toEqual({ type: 'dataset', id: 'water-quality' });
        expect(seo.classifyRoute('/resources/abc-123')).toEqual({ type: 'resource', id: 'abc-123' });
        expect(seo.classifyRoute('/insights')).toEqual({ type: 'insights' });
        expect(seo.classifyRoute('/organizations')).toEqual({ type: 'organizations' });
        expect(seo.classifyRoute('/organizations/statcan')).toEqual({ type: 'organization', id: 'statcan' });
        expect(seo.classifyRoute('/places')).toEqual({ type: 'places' });
        expect(seo.classifyRoute('/places/oshawa-on')).toEqual({ type: 'place', id: 'oshawa-on' });
        expect(seo.classifyRoute('/docs')).toEqual({ type: 'docs' });
        expect(seo.classifyRoute('/privacy')).toEqual({ type: 'privacy' });
        expect(seo.classifyRoute('/faq')).toEqual({ type: 'faq' });
        expect(seo.classifyRoute('/about')).toEqual({ type: 'about' });
    });

    it('ignores query strings and trailing slashes', () => {
        expect(seo.classifyRoute('/datasets/x?highlight=r1')).toEqual({ type: 'dataset', id: 'x' });
        expect(seo.classifyRoute('/insights/')).toEqual({ type: 'insights' });
        expect(seo.classifyRoute('/faq/?from=footer')).toEqual({ type: 'faq' });
        expect(seo.classifyRoute('/about/')).toEqual({ type: 'about' });
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

    it('emits data blocks with an escaped type and id while JSON-LD output is unchanged', () => {
        expect(seo.jsonLdScript({ x: 1 })).toBe('<script type="application/ld+json">{"x":1}</script>');
        const block = seo.jsonScript({ rows: ['</script><!--'] }, { type: 'application/json', id: 'cq-initial' });
        expect(block.startsWith('<script type="application/json" id="cq-initial">')).toBe(true);
        expect(block.endsWith('</script>')).toBe(true);
        const inner = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
        expect(inner).not.toContain('</script>');
        expect(JSON.parse(inner)).toEqual({ rows: ['</script><!--'] });
        expect(seo.jsonScript({}, { type: 'x"><script>', id: 'a"b' })).toBe('<script type="x&quot;&gt;&lt;script&gt;" id="a&quot;b">{}</script>');
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
        jurisdiction: 'federal',
    };
    const resources = [
        { id: 'r1', url: '/data/x/download/a.csv', format: 'CSV', name_en: '2025 data', name_fr: null },
        { id: 'r2', url: 'https://example.com/b.xlsx', format: 'XLSX', name_en: null, name_fr: null },
    ];

    it('builds a title that states what CanQuery adds, and a slug canonical', () => {
        const meta = seo.datasetMeta(dataset, resources);
        expect(meta.title).toBe('Water Quality (Environment Canada): 2 tables (CSV, XLSX) - CanQuery');
        expect(meta.canonical).toBe('https://canquery.com/datasets/water-quality');
        expect(meta.description).toBe('Water Quality: 2 files (CSV, XLSX) from Environment Canada, updated Jan 2026. ' +
            'Open as a table, filter, chart and export up to 10,000 rows as CSV on CanQuery.');
        expect(meta.description.length).toBeLessThanOrEqual(160);
    });

    it('keeps the publisher out of longer titles and leads with the capability phrase', () => {
        const long = { ...dataset, title_en: 'Water quality of lakes and rivers in Canada' };
        // The formats are kept only while the title still fits a search result.
        expect(seo.datasetMeta(long, resources).title).toBe('Water quality of lakes and rivers in Canada: 2 tables - CanQuery');
        expect(seo.datasetMeta({ ...long, title_en: 'Water quality of lakes in Canada' }, resources).title)
            .toBe('Water quality of lakes in Canada: 2 tables (CSV, XLSX) - CanQuery');
        const live = resources.map(resource => ({ ...resource, datastore_active: true }));
        expect(seo.datasetMeta(long, [live[0], { ...resources[1], format: 'PDF' }]).title)
            .toBe('Water quality of lakes and rivers in Canada: live table and 2 files - CanQuery');
        expect(seo.datasetMeta(long, [{ id: 'r', url: 'https://example.com/a.pdf', format: 'PDF' }]).title)
            .toBe('Water quality of lakes and rivers in Canada: PDF file - CanQuery');
    });

    it('never cuts a name mid-phrase to make room for the capability phrase', () => {
        const files = Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, format: 'CSV', url: 'https://example.test/' + i + '.zip' }));
        const titled = title_en => seo.datasetMeta({ ...dataset, title_en }, files).title;
        // No clause fits: the name takes the whole room and the phrase is left out.
        expect(titled('Revenues from domestic sales of environmental and clean technology goods and services'))
            .toBe('Revenues from domestic sales of environmental and clean technology - CanQuery');
        expect(titled('Guide to validation – drugs and supporting activities (GUI-0029)'))
            .toBe('Guide to validation – drugs and supporting activities (GUI-0029) - CanQuery');
        // A long clause before a comma stands as the name, and the phrase follows it.
        expect(titled('Merchandise imports and exports customs-based price indexes, Canada and United States trade, monthly'))
            .toBe('Merchandise imports and exports customs-based price indexes: 5 files - CanQuery');
        // A cut that leaves room for the phrase keeps it, and never ends on "… and other".
        expect(titled('Ontario public library statistics (Population group 100,001 to 250,000)'))
            .toBe('Ontario public library statistics: 5 files (CSV) - CanQuery');
        expect(titled('Sales of alcoholic beverages types by liquor authorities and other retail outlets, by value, volume'))
            .toBe('Sales of alcoholic beverages types by liquor authorities: 5 files - CanQuery');
    });

    it('spells a long federal title with its acronyms instead of a hard-coded override', () => {
        const meta = seo.datasetMeta({
            ...dataset, id: '90fed587-1364-4f33-a9ee-208181dc0b97', name: '90fed587-1364-4f33-a9ee-208181dc0b97',
            title_en: 'Temporary Foreign Worker Program (TFWP): Positive Labour Market Impact Assessment (LMIA) Employers List',
            org_title_en: 'Employment and Social Development Canada'
        }, Array.from({ length: 48 }, (_, i) => ({ id: 'r' + i, format: i % 2 ? 'CSV' : 'XLSX', url: 'https://example.test/' + i })));
        expect(meta.title).toBe('TFWP: Positive LMIA Employers List: 48 tables (CSV, XLSX) - CanQuery');
        expect(meta.description).toContain('48 files from Employment and Social Development Canada, updated Jan 2026.');
        expect(meta.jsonLd[0].name).toContain('Temporary Foreign Worker Program (TFWP)');
    });

    it('emits a schema.org Dataset with licence, keywords and absolute distributions', () => {
        const meta = seo.datasetMeta(dataset, resources);
        const ld = meta.jsonLd[0];
        expect(ld['@type']).toBe('Dataset');
        expect(ld.url).toBe('https://canquery.com/datasets/water-quality');
        expect(ld.identifier).toBe('d1');
        expect(ld.alternateName).toBe('Qualite de l eau');
        expect(ld.license).toContain('open-government-licence-canada');
        expect(ld.sameAs).toBe('https://open.canada.ca/data/en/dataset/d1');
        expect(ld.keywords).toEqual(['water', 'lakes', 'eau']); // deduped, both langs
        expect(ld.dateModified).toBe('2026-01-02T10:00:00.000Z');
        expect(ld.creator).toEqual({ '@type': 'Organization', name: 'Environment Canada' });
        // relative URL resolved to absolute against the upstream origin
        expect(ld.distribution[0].contentUrl).toBe('https://open.canada.ca/data/x/download/a.csv');
        expect(ld.distribution[1].contentUrl).toBe('https://example.com/b.xlsx');
    });

    it('falls back to the French title when English is missing', () => {
        const meta = seo.datasetMeta({ ...dataset, title_en: null }, []);
        expect(meta.title).toBe('Qualite de l eau (Environment Canada) - CanQuery');
        expect(seo.datasetMeta({ ...dataset, title_en: null, org_title_en: null }, []).title).toBe('Qualite de l eau - CanQuery');
    });

    it('states no federal licence, landing page or publisher for a record from another portal', () => {
        const municipal = { ...dataset, jurisdiction: null, provenance_sources: [] };
        const ld = seo.buildDatasetJsonLd(municipal, resources);
        expect(ld.license).toBeUndefined();
        expect(ld.sameAs).toBeUndefined();
        expect(ld.publisher).toBeUndefined();
        expect(ld.creator).toEqual({ '@type': 'Organization', name: 'Environment Canada' });
        const provincial = seo.buildDatasetJsonLd({ ...municipal, jurisdiction: 'provincial' }, resources);
        expect(provincial.sameAs).toBe('https://open.canada.ca/data/en/dataset/d1');
        expect(provincial.license).toBeUndefined();
        expect(provincial.publisher).toBeUndefined();
    });

    it('uses the authoritative municipal source for licence, publisher and sameAs', () => {
        const municipal = {
            ...dataset,
            provenance_sources: [{
                id: 'oshawa-hub', authoritative: true,
                name_en: 'City of Oshawa Open Data Hub',
                landing_url: 'https://city-oshawa.opendata.arcgis.com/datasets/roads',
                license_url: 'https://map.oshawa.ca/licence.pdf'
            }],
            places: [{ name_en: 'Oshawa', name_fr: 'Oshawa' }]
        };
        const ld = seo.buildDatasetJsonLd(municipal, []);
        expect(ld.license).toBe('https://map.oshawa.ca/licence.pdf');
        expect(ld.sameAs).toBe('https://city-oshawa.opendata.arcgis.com/datasets/roads');
        expect(ld.publisher.name).toBe('City of Oshawa Open Data Hub');
        expect(ld.spatialCoverage).toEqual(['Oshawa']);
    });

    it('synthesizes a description when notes are empty', () => {
        const meta = seo.datasetMeta({ ...dataset, notes_en: null, notes_fr: null }, []);
        expect(meta.description).toContain('Water Quality');
        expect(meta.description).toContain('Environment Canada');
    });

    it('bounds dynamic metadata and adds a canonical dataset breadcrumb', () => {
        const meta = seo.datasetMeta({
            ...dataset,
            title_en: 'A very long dataset title '.repeat(12),
            notes_en: 'A very long dataset description '.repeat(20)
        }, []);
        expect(meta.title.length).toBeLessThanOrEqual(80);
        expect(meta.title).toMatch(/ - CanQuery$/);
        expect(meta.description.length).toBeLessThanOrEqual(160);
        const breadcrumb = meta.jsonLd.find(item => item['@type'] === 'BreadcrumbList');
        expect(breadcrumb.itemListElement).toEqual([
            expect.objectContaining({ position: 1, name: 'Datasets', item: 'https://canquery.com/datasets' }),
            expect.objectContaining({
                position: 2,
                item: 'https://canquery.com/datasets/water-quality'
            })
        ]);
    });
});

describe('seoMeta - resource titles, capabilities and breadcrumbs', () => {
    const base = {
        id: 'r1', dataset_id: 'd1', dataset_name: 'water-quality',
        name_en: 'Measurements', dataset_title_en: 'Water Quality',
        format: 'CSV', size_bytes: 1024
    };

    test.each([
        [base, 'https://canquery.com/datasets/water-quality'],
        [{ ...base, dataset_name: 'eau/qualité' }, 'https://canquery.com/datasets/eau%2Fqualit%C3%A9'],
        [{ ...base, dataset_name: null }, 'https://canquery.com/datasets/d1']
    ])('references the complete parent dataset without declaring an incomplete Dataset: %#', (resource, parentUrl) => {
        const meta = seo.resourceMeta({
            ...resource, url: 'https://example.test/data.csv',
            provenance_sources: [{ authoritative: true, license_url: 'https://example.test/license' }]
        });
        const page = meta.jsonLd.find(item => item['@type'] === 'WebPage');
        expect(page.mainEntity).toEqual({
            '@type': 'DataDownload', name: 'Measurements (CSV)', encodingFormat: 'CSV',
            contentSize: '1 KB', contentUrl: 'https://example.test/data.csv',
            license: 'https://example.test/license', isPartOf: parentUrl
        });
        expect(JSON.stringify(meta.jsonLd)).not.toContain('"@type":"Dataset"');
        expect(meta.canonical).toBe('https://canquery.com/resources/r1');
        expect(meta.noindex).not.toBe(true);
    });

    it('omits the parent reference when no dataset identity is available', () => {
        const meta = seo.resourceMeta({ ...base, dataset_id: null, dataset_name: null });
        expect(meta.jsonLd[0].mainEntity).not.toHaveProperty('isPartOf');
    });

    test.each([null, undefined, ''])('omits unknown size %s instead of inventing zero bytes', size => {
        const meta = seo.resourceMeta({ ...base, size_bytes: size });
        expect(meta.jsonLd.find(item => item['@type'] === 'WebPage').mainEntity.contentSize).toBeUndefined();
    });

    it('preserves an explicitly reported zero-byte file size', () => {
        const meta = seo.resourceMeta({ ...base, size_bytes: 0 });
        expect(meta.jsonLd.find(item => item['@type'] === 'WebPage').mainEntity.contentSize).toBe('0 bytes');
    });

    it('falls back from generic resource names and appends a missing format once', () => {
        expect(seo.resourceMeta({ ...base, name_en: 'Dataset' }).title)
            .toBe('Water Quality (CSV table) - CanQuery');
        expect(seo.resourceMeta({ ...base, name_en: 'Measurements CSV' }).title)
            .toBe('Water Quality — Measurements CSV (table) - CanQuery');
        expect(seo.resourceMeta({ ...base, name_en: 'English' }).title)
            .toBe('Water Quality (CSV table) - CanQuery');
        expect(seo.resourceMeta({ ...base, name_en: 'Report', format: 'PDF' }).title)
            .toBe('Water Quality — Report (PDF) - CanQuery');
    });

    it('keeps download-only pages out of the index and table or map pages in it', () => {
        expect(seo.resourceMeta({ ...base, format: 'PDF' }).noindex).toBe(true);
        expect(seo.resourceMeta({ ...base, format: 'HTML', url: 'https://example.test/guide.html' }).noindex).toBe(true);
        expect(seo.resourceMeta({ ...base, format: 'CSV', url: 'https://example.test/archive.zip' }).noindex).toBe(true);
        expect(seo.resourceMeta(base).noindex).toBeUndefined();
        expect(seo.resourceMeta({ ...base, format: 'PDF', map_provider: 'arcgis' }).noindex).toBeUndefined();
        expect(seo.resourceMeta({ ...base, format: 'PDF', datastore_active: true }).noindex).toBeUndefined();
        expect(seo.resourceMeta({ ...base, format: 'PDF', ingest_status: 'ready' }).noindex).toBeUndefined();
    });

    it('names the table or map a resource becomes on CanQuery in its title', () => {
        expect(seo.resourceMeta({ ...base, ingest_status: 'ready', language: 'en' }).title)
            .toBe('Water Quality — Measurements (English, CSV live table) - CanQuery');
        expect(seo.resourceMeta({ ...base, datastore_active: true, map_provider: 'arcgis' }).title)
            .toBe('Water Quality — Measurements (CSV live table and map) - CanQuery');
        expect(seo.resourceMeta({ ...base, format: 'GeoJSON', map_provider: 'canquery' }).title)
            .toBe('Water Quality — Measurements (GEOJSON map) - CanQuery');
    });

    it('gives files that share a name across datasets distinct titles', () => {
        const dictionary = { ...base, name_en: 'Data dictionary', datastore_active: true };
        const permits = seo.resourceMeta({ ...dictionary, dataset_title_en: 'Building Permits' }).title;
        const trees = seo.resourceMeta({ ...dictionary, dataset_title_en: 'Street Trees' }).title;
        expect(permits).toBe('Building Permits — Data dictionary (CSV live table) - CanQuery');
        expect(trees).toBe('Street Trees — Data dictionary (CSV live table) - CanQuery');
        // A name that already carries its dataset's title is not repeated.
        expect(seo.resourceMeta({ ...base, name_en: 'Water Quality 2023 readings' }).title)
            .toBe('Water Quality 2023 readings (CSV table) - CanQuery');
    });

    it('adds the publisher to a short shared title and the dataset year when the dataset title cannot fit', () => {
        expect(seo.resourceMeta({ ...base, name_en: 'Parks', dataset_title_en: 'Parks', org_title_en: 'City of Oshawa' }).title)
            .toBe('Parks — City of Oshawa (CSV table) - CanQuery');
        expect(seo.resourceMeta({ ...base, name_en: 'CSV', dataset_title_en: 'Zoning', org_title_en: 'City of Regina' }).title)
            .toBe('Zoning — City of Regina (CSV table) - CanQuery');
        const officers = seo.resourceMeta({ ...base, name_en: 'Charities businesses directors/officers',
            dataset_title_en: '2024 List of charities', datastore_active: true }).title;
        expect(officers).toBe('Charities businesses directors/officers — 2024 (CSV live table) - CanQuery');
        const long = seo.resourceMeta({ ...base, name_en: 'Measurements', dataset_title_en: 'Supercalifragilisticexpialidocious'.repeat(3) }).title;
        expect(long).toBe('Measurements (CSV table) - CanQuery');
        expect(long).not.toContain('…');
    });

    it('tells same-named yearly files of one dataset apart by the year in their file names', () => {
        const ratios = { ...base, name_en: 'Key ratios', format: 'XLSX', language: 'fr',
            dataset_title_en: 'Ontario public library statistics (Population group 100,001 to 250,000)',
            org_title_en: 'Government of Ontario', url: 'https://files.ontario.ca/mtcg-100001-250000-key-ratios-fr-2023.xlsx' };
        // Alone in its dataset, the file keeps its title.
        expect(seo.resourceMeta(ratios).title).toBe('Key ratios — Government of Ontario (French, XLSX table) - CanQuery');
        const sibling = { ...ratios, same_name_siblings: 3 };
        expect(seo.resourceMeta(sibling).title).toBe('Key ratios 2023 — Government of Ontario (French, XLSX table) - CanQuery');
        expect(seo.resourceTitleBase(sibling)).toBe('Key ratios 2023 (French, XLSX)');
        expect(seo.resourceMeta(sibling).description).toMatch(/^Key ratios 2023: French XLSX file/);
        // A fiscal year stays whole; a name with its own year, a range and a digit run add nothing.
        expect(seo.resourceTitleBase({ ...sibling, url: 'https://x.test/fin-2006-07-operation.pdf', format: 'PDF' }))
            .toBe('Key ratios 2006–07 (French, PDF)');
        expect(seo.resourceTitleBase({ ...sibling, name_en: 'Key ratios 2022' })).toBe('Key ratios 2022 (French, XLSX)');
        expect(seo.resourceTitleBase({ ...sibling, url: 'https://x.test/ratios_2019-2021.xlsx' })).toBe('Key ratios (French, XLSX)');
        expect(seo.resourceTitleBase({ ...sibling, url: 'https://x.test/20240115.xlsx' })).toBe('Key ratios (French, XLSX)');
        // A download label's year joins a whole dataset title, or follows the label when the title is cut.
        const maps = { ...base, format: 'JP2', language: 'en', name_en: 'Download the English JP2 File through HTTP',
            url: 'https://x.test/map_1984.jp2', same_name_siblings: 4 };
        expect(seo.resourceMeta({ ...maps, dataset_title_en: 'Forest cover maps' }).title)
            .toBe('Forest cover maps 1984 — English (English, JP2) - CanQuery');
        expect(seo.resourceMeta({ ...maps, dataset_title_en: 'Forest cover maps of the northern boreal plains and the southern taiga regions' }).title)
            .toBe('Forest cover maps of the northern boreal plains — English 1984 (JP2) - CanQuery');
    });

    it('leads with a whole dataset title or its first clause, never a fragment of it', () => {
        const tables = { ...base, name_en: 'Data tables', datastore_active: true };
        expect(seo.resourceMeta({ ...tables, dataset_title_en: 'Report on Federal Tax Expenditures - Concepts, Estimates and Evaluations 2024' }).title)
            .toBe('Report on Federal Tax Expenditures — Data tables (CSV live table) - CanQuery');
        expect(seo.resourceMeta({ ...base, name_en: 'Enrolment counts', datastore_active: true,
            dataset_title_en: 'French as a Second Language enrolment by province and grade level' }).title)
            .toBe('Enrolment counts (CSV live table) - CanQuery');
        // A dataset title that already covers the file name is not repeated before it.
        expect(seo.resourceMeta({ ...base, name_en: 'Electricity Generation', dataset_title_en: 'Electricity generation by source' }).title)
            .toBe('Electricity Generation (CSV table) - CanQuery');
    });

    it('keeps the subject whole before the language and table words', () => {
        const votes = { ...base, name_en: 'Table 6: Distribution of valid votes under Special Voting Rules',
            dataset_title_en: '44th General Election: Official Voting Results', datastore_active: true, language: 'en,fr' };
        // Bilingual: the language pair goes first, then the format and table words.
        expect(seo.resourceMeta(votes).title).toBe('Table 6: Distribution of valid votes under Special Voting Rules - CanQuery');
        expect(seo.resourceMeta({ ...votes, name_en: 'Downloads per organization, last 12 months' }).title)
            .toBe('Downloads per organization, last 12 months (CSV live table) - CanQuery');
        // A subject that fits with every word keeps them all.
        expect(seo.resourceMeta({ ...votes, name_en: 'Activities outside Canada' }).title)
            .toBe('Activities outside Canada (English, French, CSV live table) - CanQuery');
        // English is the default and goes before the table words; "French" stays.
        const projects = { ...base, name_en: 'Park and Recreation Facility Projects', dataset_title_en: 'Park and Recreation Facility Projects',
            datastore_active: true, map_provider: 'arcgis' };
        expect(seo.resourceMeta({ ...projects, language: 'en' }).title)
            .toBe('Park and Recreation Facility Projects (CSV live table and map) - CanQuery');
        const ridings = { ...base, name_en: 'History of the Federal Electoral Ridings, 1867-2010',
            dataset_title_en: 'History of the Federal Electoral Ridings', language: 'fr' };
        expect(seo.resourceMeta(ridings).title).toBe('History of the Federal Electoral Ridings, 1867-2010 (French) - CanQuery');
        expect(seo.resourceMeta({ ...ridings, language: 'en' }).title)
            .toBe('History of the Federal Electoral Ridings, 1867-2010 (CSV table) - CanQuery');
        // A subject too long to stand whole is cut behind the shorter qualifier.
        const cndss = { ...base, language: 'en', dataset_title_en: 'CNDSS annual counts',
            name_en: 'Canadian Notifiable Disease Surveillance System Counts and Rates of Reported Cases of Nationally Notifiable Diseases, 1991-2016' };
        expect(seo.resourceMeta(cndss).title).toBe('Canadian Notifiable Disease Surveillance System Counts (CSV table) - CanQuery');
        expect(seo.resourceMeta({ ...cndss, language: 'fr' }).title)
            .toBe('Canadian Notifiable Disease Surveillance System (French, CSV table) - CanQuery');
    });

    it('does not repeat a language the name already states', () => {
        const quakes = { ...base, name_en: 'Canadian Earthquakes (English)', dataset_title_en: 'Earthquakes in Canada 2010-2019', language: 'en' };
        expect(seo.resourceMeta(quakes).title).toBe('Canadian Earthquakes (English) — 2010-2019 (CSV table) - CanQuery');
        expect(seo.resourceTitleBase(quakes)).toBe('Canadian Earthquakes (English) (CSV)');
        expect(seo.resourceTitleBase({ ...quakes, name_en: 'Séismes canadiens (français)', language: 'fr' }, null, 'fr'))
            .toBe('Séismes canadiens (français) (CSV)');
        expect(seo.resourceTitleBase({ ...quakes, language: 'en,fr' })).toBe('Canadian Earthquakes (English) (French, CSV)');
    });

    it('cuts file-name style titles at their underscores instead of mid-word', () => {
        expect(seo.compactTitle('Arctic_PRISM_Surveys_Tier1_Birds_Data_Donnees_Oiseaux.csv', 40)).toBe('Arctic_PRISM_Surveys_Tier1_Birds_Data');
        expect(seo.compactTitle('motor-vehicle-serious-injuries-by-road-user-type', 45)).toBe('motor-vehicle-serious-injuries-by-road-user');
    });

    it('bounds long resource titles and descriptions', () => {
        const meta = seo.resourceMeta({
            ...base,
            name_en: 'Specific annual measurement export '.repeat(10),
            dataset_title_en: 'Water quality observations '.repeat(12)
        });
        expect(meta.title.length).toBeLessThanOrEqual(80);
        expect(meta.description.length).toBeLessThanOrEqual(160);
        expect(meta.canonical).toBe('https://canquery.com/resources/r1');
    });

    test.each([
        [{ ...base, ingest_status: 'ready', ingested_row_count: 1200, ingested_columns: [{ id: 'a' }, { id: 'b' }] },
            'Measurements: live CSV table with 1,200 rows and 2 fields. Filter, chart and export up to 10,000 rows as CSV.'],
        [{ ...base, datastore_active: true }, 'Measurements: live CSV table. Filter, chart and export up to 10,000 rows as CSV.'],
        [base, 'Measurements: CSV file (1 KB) you can open as a table, filter, chart and export up to 10,000 rows.'],
        [{ ...base, format: 'PDF', map_provider: 'arcgis' }, 'Measurements: interactive map on CanQuery, plus the original PDF download (1 KB).'],
        [{ ...base, format: 'PDF' }, 'Measurements: PDF file (1 KB). View metadata, licence and the direct download on CanQuery.']
    ])('writes truthful capability-specific copy for %#', (resource, expected) => {
        expect(seo.resourceMeta(resource).description).toBe(expected);
    });

    it('adds the publisher and record date, dropping them first when space runs out', () => {
        const dated = { ...base, org_title_en: 'Environment Canada', last_modified: '2026-03-04T00:00:00Z' };
        expect(seo.resourceMeta(dated).description).toBe('Measurements: CSV file (1 KB) you can open as a table, filter, ' +
            'chart and export up to 10,000 rows. From Environment Canada, updated Mar 2026.');
        const shorter = seo.resourceMeta({ ...dated, name_en: 'Measurements of a very long and specific indicator' }).description;
        expect(shorter).toMatch(/\. Updated Mar 2026\.$/);
        expect(shorter).not.toContain('From ');
        expect(shorter.length).toBeLessThanOrEqual(160);
        const shortest = seo.resourceMeta({ ...dated, name_en: 'Measurements of a very long and specific indicator series' }).description;
        expect(shortest).toMatch(/10,000 rows\.$/);
        expect(shortest.length).toBeLessThanOrEqual(160);
        expect(seo.resourceDescription(dated, { lang: 'fr', max: 1200 })).toBe('Measurements : fichier CSV (1 ko) à ouvrir comme tableau pour ' +
            'filtrer, créer des graphiques et exporter jusqu’à 10 000 lignes. Source : Environment Canada, mis à jour mars 2026.');
        expect(seo.resourceDescription(dated, { lang: 'fr' })).toMatch(/lignes\. Mis à jour mars 2026\.$/);
    });

    it('emits the stable dataset and UUID resource hierarchy', () => {
        const meta = seo.resourceMeta(base);
        const breadcrumb = meta.jsonLd.find(item => item['@type'] === 'BreadcrumbList');
        expect(breadcrumb.itemListElement).toEqual([
            expect.objectContaining({ position: 1, name: 'Datasets', item: 'https://canquery.com/datasets' }),
            expect.objectContaining({
                position: 2, name: 'Water Quality',
                item: 'https://canquery.com/datasets/water-quality'
            }),
            expect.objectContaining({
                position: 3, name: 'Measurements (CSV)',
                item: 'https://canquery.com/resources/r1'
            })
        ]);
    });
});

describe('publisher download names', () => {
    test.each([
        ['Download EDI through HTTP', 'EDI', ''],
        ['Télécharger le fichier en format EDI via HTTP', 'EDI', ''],
        ['Download the English JP2 File through HTTP', 'JP2', ' — English'],
        ['Télécharger le fichier en format JPEG2000 Anglais via HTTP', 'JP2', ' — anglais'],
        ['Download SHP file through FTP', 'SHP', ''],
        ['Téléchargez le fichier SHP via FTP', 'SHP', ''],
    ])('replaces boilerplate %s with parent context throughout the page', (name, format, qualifier) => {
        const resource = Object.freeze({ id: 'r', name_en: name, dataset_id: 'd',
            dataset_title_en: 'Site ten911', format, language: ['en', 'fr'], url: 'https://example.test/file' });
        const meta = seo.resourceMeta(resource);
        const label = 'Site ten911' + qualifier + ' (English, French, ' + format + ')';
        expect(meta.title).toBe(label + ' - CanQuery');
        expect(meta.description).toContain('Site ten911' + qualifier);
        expect(meta.jsonLd[0].name).toBe(label);
        expect(meta.jsonLd[0].mainEntity.name).toBe(label);
        expect(meta.jsonLd[0].mainEntity.contentUrl).toBe(resource.url);
        expect(meta.jsonLd[1].itemListElement.at(-1).name).toBe(label);
        expect(meta.canonical).toBe('https://canquery.com/resources/r');
        // A download-only file's page repeats its dataset page: noindex, links followed.
        expect(meta.noindex).toBe(true);
        expect(seo.resourceMeta({ ...resource, dataset_title_en: 'Site abt179' }).title).not.toBe(meta.title);
        expect(resource.name_en).toBe(name);
    });

    test.each(['Download traffic collision records CSV through HTTP', 'Download SHP file through FTP — 2024',
        'Water quality observations', 'English monitoring stations'])('preserves meaningful names: %s', name => {
        expect(seo.isGenericResourceName(name, 'SHP')).toBeFalsy();
        expect(seo.resourceTitleBase({ name_en: name, dataset_title_en: 'Parent', format: 'SHP' })).toContain(name);
    });

    test('retains a file qualifier or period within bounded titles and keeps a missing-parent fallback', () => {
        const resource = { id: 'r', name_en: 'Download the English JP2 File through HTTP',
            dataset_title_en: 'Long subject with more words '.repeat(10), format: 'JP2', language: 'en,fr' };
        const meta = seo.resourceMeta(resource);
        expect(meta.title.length).toBeLessThanOrEqual(80);
        expect(meta.description.length).toBeLessThanOrEqual(160);
        // The bilingual pair gives way to the subject once the subject must be cut.
        expect(meta.title).toContain(' — English (JP2) - CanQuery');
        expect(seo.resourceTitleBase(resource)).toContain(' — English (English, French, JP2)');
        expect(seo.resourceMeta({ ...resource, name_en: 'Q4 2025' }).title).toContain(' — Q4 2025');
        expect(seo.resourceTitleBase({ name_en: 'Download EDI through HTTP', format: 'EDI' })).toBe('Download EDI through HTTP');
        expect(seo.resourceTitleBase({})).toBe('Resource');
    });
});

describe('seoMeta - site + static meta', () => {
    it('home meta carries a WebSite SearchAction and an Organization', () => {
        const meta = seo.homeMeta();
        expect(meta.title).toBe('Canadian open data & government datasets - CanQuery');
        expect(meta.title.length).toBeLessThanOrEqual(80);
        expect(meta.description).toBe('Search Canadian government datasets by place and topic. Find CSV downloads, explore supported tables and maps, and use CanQuery’s free API.');
        expect(meta.description.length).toBeLessThanOrEqual(160);
        expect(meta.canonical).toBe('https://canquery.com/');
        const types = meta.jsonLd.map((o) => o['@type']);
        expect(types).toContain('WebSite');
        expect(types).toContain('Organization');
        const website = meta.jsonLd.find((o) => o['@type'] === 'WebSite');
        expect(website.description).toBe(meta.description);
        expect(website.potentialAction['@type']).toBe('SearchAction');
        expect(website.potentialAction.target.urlTemplate).toContain('{search_term_string}');
        // A page title is not an alternate site name.
        expect(website.alternateName).toBeUndefined();
        const organization = meta.jsonLd.find((o) => o['@type'] === 'Organization');
        expect(organization.logo).toBe('https://canquery.com/android-chrome-512.png');
        expect(organization.sameAs).toEqual(['https://github.com/RyuPrad/canquery', 'https://bsky.app/profile/canquery.com']);
    });

    it('builds indexable metadata for place pages', () => {
        const meta = seo.placeMeta({
            id: 'sgc-cd-3506', slug: 'ottawa-on', name_en: 'Ottawa',
            type_en: 'City', latitude: 45.4215, longitude: -75.6972, dataset_count: 12,
            ancestors: [
                { id: 'ca', slug: 'canada', name_en: 'Canada' },
                { id: 'sgc-cd-3506', slug: 'ottawa-on', name_en: 'Ottawa' }
            ]
        });
        expect(meta.canonical).toBe('https://canquery.com/places/ottawa-on');
        expect(meta.jsonLd[0]['@type']).toBe('AdministrativeArea');
        expect(meta.jsonLd[0].geo.latitude).toBeCloseTo(45.4215);
        const breadcrumb = meta.jsonLd.find(item => item['@type'] === 'BreadcrumbList');
        expect(breadcrumb.itemListElement).toEqual([
            expect.objectContaining({ position: 1, name: 'Places', item: 'https://canquery.com/places' }),
            expect.objectContaining({ position: 2, name: 'Canada', item: 'https://canquery.com/places/canada' }),
            expect.objectContaining({ position: 3, name: 'Ottawa', item: 'https://canquery.com/places/ottawa-on' })
        ]);
    });

    it('static sections get a title and a clean canonical', () => {
        expect(seo.staticMeta('docs').canonical).toBe('https://canquery.com/docs');
        expect(seo.staticMeta('docs').title).toContain('API documentation');
        expect(seo.staticMeta('insights').title).toContain('Top 100');
        expect(seo.staticMeta('privacy').canonical).toBe('https://canquery.com/privacy');
    });

    test.each(['faq', 'about'])('keeps the %s information page indexable with its own canonical', type => {
        const meta = seo.staticMeta(type, '/' + type + '/?from=footer');
        expect(meta.canonical).toBe('https://canquery.com/' + type);
        expect(meta.title).not.toBe(seo.DEFAULT_TITLE);
        expect(meta.title.length).toBeLessThanOrEqual(80);
        expect(meta.description.length).toBeLessThanOrEqual(160);
        expect(meta.noindex).not.toBe(true);
        expect(JSON.stringify(meta.jsonLd || [])).not.toContain('FAQPage');
    });

    it('keeps empty or disabled place and empty organization pages out of the index', () => {
        expect(seo.placeMeta({ id: 'p0', slug: 'empty', name_en: 'Empty', dataset_count: 0 }).noindex).toBe(true);
        expect(seo.placeMeta({ id: 'p1', slug: 'old', name_en: 'Old', dataset_count: 3, enabled: false }).noindex).toBe(true);
        expect(seo.placeMeta({ id: 'p2', slug: 'live', name_en: 'Live', dataset_count: 3, enabled: true }).noindex).toBe(false);
        expect(seo.organizationMeta({ id: 'o0', name: 'empty', title_en: 'Empty', dataset_count: 0 }).noindex).toBe(true);
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
        expect(html).toContain('<title>A &amp; B - CanQuery</title>');
        expect(html).toContain('<link rel="canonical" href="https://canquery.com/datasets/n" />');
        expect(html).toContain('application/ld+json');
        expect(html).not.toContain('<title>default</title>');
    });

    it('shares a raster preview image with its size and description', () => {
        const html = seo.renderHtml(template, seo.homeMeta());
        expect(html).toContain('<meta property="og:image" content="https://canquery.com/og-image.png" />');
        expect(html).toContain('<meta property="og:image:width" content="1200" />');
        expect(html).toContain('<meta property="og:image:height" content="630" />');
        expect(html).toContain('<meta property="og:image:alt" content="CanQuery: Canadian open data search, tables and maps" />');
        expect(html).toContain('<meta name="twitter:image" content="https://canquery.com/og-image.png" />');
        expect(html).toContain('<meta name="twitter:image:alt" content="CanQuery: Canadian open data search, tables and maps" />');
        expect(html).not.toContain('og-image.svg');
    });

    it('adds a robots noindex tag when requested', () => {
        const html = seo.renderHtml(template, seo.notFoundMeta('/x'));
        expect(html).toContain('name="robots" content="noindex');
    });

    // Regression: a string replacement interprets $&, $', $` and $$ as
    // substitution patterns; escapeHtml turns "$'000" into "$&#39;000", whose
    // "$&" used to re-inject the whole managed block into the middle of the
    // title (duplicate <title>/canonical tags on the served page).
    it('treats $-sequences in dataset text literally, not as replace patterns', () => {
        const meta = seo.datasetMeta(
            {
                id: 'd',
                name: 'n',
                title_en: "Grants and Contributions ($'000)",
                org_title_en: 'Amounts in $&thousands, per $`unit, paid in CA$$',
                notes_en: 'Amounts in $&thousands, per $`unit, paid in CA$$.',
            },
            []
        );
        const html = seo.renderHtml(template, meta);
        expect(html).toContain('<title>Grants and Contributions ($&#39;000) - CanQuery</title>');
        expect(html).toContain('from Amounts in $&amp;thousands, per $`unit, paid in CA$$.');
        expect(html.match(/<title>/g)).toHaveLength(1);
        expect(html.match(/rel="canonical"/g)).toHaveLength(1);
        expect(html).not.toContain('<title>default</title>');
    });

    it('returns the template untouched when the markers are absent', () => {
        const plain = '<html><head><title>x</title></head></html>';
        expect(seo.renderHtml(plain, seo.homeMeta())).toBe(plain);
    });

    it('injects a semantic crawl snapshot into the empty React root', () => {
        const page = '<html><head><!-- seo:start --><!-- seo:end --></head><body><div id="root"></div></body></html>';
        const html = seo.renderHtml(page, seo.homeMeta(), '<main><h1>Search open data</h1></main>');
        expect(html).toContain('<div id="root"><main><h1>Search open data</h1></main></div>');
    });
});

describe('seoMeta - content hygiene and organization pages', () => {
    it('strips markup and makes short Dataset descriptions schema-eligible', () => {
        const dataset = {
            id: 'd1', name: 'roads', title_en: 'Roads', title_fr: 'Routes',
            notes_en: '<p>Roads<br>updated</p><script>bad()</script>',
            org_title_en: 'City Works'
        };
        const ld = seo.buildDatasetJsonLd(dataset, []);
        expect(ld.description).toContain('Roads updated');
        expect(ld.description).not.toContain('<');
        expect(ld.description).not.toContain('bad()');
        expect(ld.description.length).toBeGreaterThanOrEqual(50);
    });

    it('decodes common French entities and rejects non-HTTP distributions', () => {
        expect(seo.plainText('Ville de Qu&eacute;bec &amp; L&eacute;vis')).toBe('Ville de Québec & Lévis');
        const ld = seo.buildDatasetJsonLd({
            id: 'd1', name: 'roads', title_en: 'Roads', notes_en: 'A sufficiently descriptive public road dataset for testing.'
        }, [
            { url: 'javascript:alert(1)', format: 'CSV' },
            { url: 'https://example.test/roads.csv', format: 'CSV', size_bytes: 2048 }
        ]);
        expect(ld.distribution).toHaveLength(1);
        expect(ld.distribution[0]).toEqual(expect.objectContaining({
            contentUrl: 'https://example.test/roads.csv', contentSize: '2 KB'
        }));
    });

    it('gives every distribution a format and leaves out links to web pages', () => {
        const ld = seo.buildDatasetJsonLd({
            id: 'd1', name: 'roads', title_en: 'Roads', notes_en: 'A sufficiently descriptive public road dataset for testing.'
        }, [
            { url: 'https://example.test/data/roads.geojson', format: '' },
            { url: 'https://open.canada.ca/data/en/dataset/8fb91584-0bdf-4fc0-a1c6-dcbd9ca30fb9', format: null },
            { url: 'https://example.test/roads/overview.html' },
            { url: 'https://example.test/roads.csv', format: 'CSV' }
        ]);
        expect(ld.distribution.map(item => [item.contentUrl, item.encodingFormat])).toEqual([
            ['https://example.test/data/roads.geojson', 'GEOJSON'],
            ['https://example.test/roads.csv', 'CSV']
        ]);
    });

    it('builds bounded organization metadata and CollectionPage schema', () => {
        const organization = {
            id: 'o1', name: 'city-works', title_en: 'City Works',
            dataset_count: 23, queryable_dataset_count: 4, mappable_dataset_count: 8
        };
        const meta = seo.organizationMeta(organization, [{ id: 'd1', name: 'roads', title_en: 'Roads' }]);
        expect(meta.title).toBe('City Works: 23 open datasets, tables and maps - CanQuery');
        expect(meta.description).toBe('City Works publishes 23 open datasets on CanQuery: 4 with live tables and 8 with maps. ' +
            'Preview tables, export CSV and follow original downloads.');
        expect(meta.canonical).toBe('https://canquery.com/organizations/city-works');
        const collection = meta.jsonLd.find(item => item['@type'] === 'CollectionPage');
        expect(collection.mainEntity.numberOfItems).toBe(23);
        expect(collection.mainEntity.itemListElement[0].url).toBe('https://canquery.com/datasets/roads');
        expect(collection.about['@type']).toBe('Organization');
        const municipal = seo.organizationMeta({ ...organization, place_id: 'p1', place_name_en: 'Example' }, []);
        expect(municipal.jsonLd[0].about['@type']).toBe('GovernmentOrganization');
        expect(municipal.description).toContain(' Part of Example open data. ');
        expect(seo.organizationMeta({ ...organization, government: true }, []).jsonLd[0].about['@type']).toBe('GovernmentOrganization');
        expect(seo.organizationMeta({ ...organization, queryable_dataset_count: 0, mappable_dataset_count: 0 }, []).title)
            .toBe('City Works: 23 open datasets - CanQuery');
        expect(seo.organizationMeta({ ...organization, mappable_dataset_count: 0 }, []).title)
            .toBe('City Works: 23 open datasets and tables - CanQuery');
        expect(seo.organizationMeta({ ...organization, title_en: 'Innovation, Science and Economic Development Canada' }, []).title)
            .toBe('Innovation, Science and Economic Development Canada: 23 open datasets - CanQuery');
        expect(seo.organizationMeta({ ...organization, title_en: 'Innovation, Science and Economic Development Canada', dataset_count: 12345 }, []).title)
            .toBe('Innovation, Science and Economic Development Canada open data - CanQuery');
    });
});

describe('seoMeta - title compaction, paging and place names', () => {
    it('collapses spelled-out acronyms and leading clauses before cutting words, never with an ellipsis', () => {
        const long = 'Temporary Foreign Worker Program (TFWP): Positive Labour Market Impact Assessment (LMIA) Employers List';
        expect(seo.compactTitle(long, 60)).toBe('TFWP: Positive LMIA Employers List');
        expect(seo.compactTitle(long, 200)).toBe(long);
        expect(seo.compactTitle('Ward Boundaries for 2021 October 18 General Election (2021) results and maps', 40))
            .toBe('Ward Boundaries for 2021 October 18');
        expect(seo.compactTitle('Building Permits - Active Permits with a very long qualifying tail', 40)).toBe('Building Permits - Active Permits');
        expect(seo.compactTitle("Grants and Contributions ($'000) with a very long tail of words", 40)).toBe("Grants and Contributions ($'000)");
        expect(seo.compactTitle('A lengthy publisher dataset title '.repeat(10), 21)).toBe('A lengthy publisher');
        expect(seo.compactTitle('Supercalifragilisticexpialidocious statistics', 12)).toBe('Supercalifr…');
    });

    it('prefers titles that fit a search result, then the hard bound, then a compacted last resort', () => {
        expect(seo.fitTitle(['A'.repeat(70), 'B'.repeat(65), 'C'.repeat(50)])).toBe('C'.repeat(50));
        expect(seo.fitTitle(['A'.repeat(70), 'B'.repeat(65)])).toBe('B'.repeat(65));
        expect(seo.fitTitle(['Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron']).length).toBeLessThanOrEqual(69);
        expect(seo.fitTitle([])).toBe('Open data');
        // A tier with the facts is kept while any of its candidates fits the hard bound.
        expect(seo.fitTitleTiers([['A'.repeat(70), 'B'.repeat(65)], ['C'.repeat(20)]])).toBe('B'.repeat(65));
        expect(seo.fitTitleTiers([['A'.repeat(70)], ['C'.repeat(20)]])).toBe('C'.repeat(20));
        expect(seo.fitTitleTiers([['A'.repeat(70)], ['B'.repeat(80)]]).length).toBeLessThanOrEqual(69);
    });

    it('labels later pages in the title and description', () => {
        const meta = seo.pagedMeta({ title: 'Roads - CanQuery', description: 'D'.repeat(160) }, 3);
        expect(meta.title).toBe('Roads (page 3) - CanQuery');
        expect(meta.description.endsWith(' (page 3)')).toBe(true);
        expect(meta.description.length).toBeLessThanOrEqual(160);
        expect(seo.pagedMeta({ title: 'Roads - CanQuery', description: 'D' }, 1).title).toBe('Roads - CanQuery');
        const long = seo.pagedMeta({ title: 'W'.repeat(69) + ' - CanQuery', description: 'D' }, 12);
        expect(long.title.length).toBeLessThanOrEqual(80);
        expect(long.title.endsWith(' (page 12) - CanQuery')).toBe(true);
    });

    it('names the province of regions and municipalities and counts datasets and maps in place titles', () => {
        const ancestors = [
            { id: 'ca', slug: 'canada', kind: 'country', name_en: 'Canada' },
            { id: 'on', slug: 'ontario', kind: 'province', name_en: 'Ontario' },
            { id: 'p', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa' }
        ];
        const meta = seo.placeMeta({ id: 'p', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa', type_en: 'City',
            dataset_count: 200, mappable_dataset_count: 150, ancestors }, []);
        expect(meta.title).toBe('Oshawa, Ontario open data: 200 datasets and 150 maps - CanQuery');
        expect(meta.description).toBe('200 open datasets for Oshawa, Ontario (City): 150 with interactive maps. ' +
            'Browse by publisher and format, preview tables and export CSV on CanQuery.');
        expect(meta.jsonLd[1].name).toBe('Oshawa open data');
        const withTables = seo.placeMeta({ id: 'p', slug: 'oka-qc', kind: 'municipality', name_en: 'Oka',
            dataset_count: 9, mappable_dataset_count: 5, ancestors: [ancestors[0], { id: 'qc', slug: 'quebec', kind: 'province', name_en: 'Quebec' }] }, [], { queryable: 4 });
        expect(withTables.title).toBe('Oka, Quebec open data: 9 datasets, 4 live tables and 5 maps - CanQuery');
        expect(withTables.description).toContain(': 5 with interactive maps, 4 with live tables.');
        // The live-table count stays in the description when the title would overflow a search result.
        const longer = seo.placeMeta({ id: 'p', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa',
            dataset_count: 200, mappable_dataset_count: 150, ancestors }, [], { queryable: 40 });
        expect(longer.title).toBe('Oshawa, Ontario open data: 200 datasets and 150 maps - CanQuery');
        expect(longer.description).toContain(', 40 with live tables.');
        expect(seo.placeMeta({ id: 'on', slug: 'ontario', kind: 'province', name_en: 'Ontario', dataset_count: 12085, ancestors: ancestors.slice(0, 2) }, []).title)
            .toBe('Ontario open data: 12,085 datasets - CanQuery');
        expect(seo.placeMeta({ id: 'p0', slug: 'empty', kind: 'municipality', name_en: 'Empty', dataset_count: 0, ancestors }, []).title)
            .toBe('Empty, Ontario open data - CanQuery');
    });

    it('describes a place hub by government level and access when the counts are known', () => {
        const ancestors = [{ id: 'ca', kind: 'country', name_en: 'Canada' }, { id: 'on', kind: 'province', name_en: 'Ontario' }];
        const facets = { total: 200, facets: { level: [{ value: 'municipal', count: 20 }, { value: 'provincial', count: 180 }],
            access: [{ value: 'queryable', count: 40 }, { value: 'mappable', count: 150 }], organization: [], source: [], format: [], keyword: [] } };
        const meta = seo.placeMeta({ id: 'p', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa', type_en: 'City',
            dataset_count: 200, mappable_dataset_count: 150, ancestors }, [], { facets });
        // The long closing sentence makes 166 characters here, so the shorter one is used.
        expect(meta.description).toBe('200 open datasets for Oshawa, Ontario: 20 municipal and 180 provincial; 150 with maps, 40 with live tables. ' +
            'Publishers, portals and guides on CanQuery.');
        expect(meta.title).toBe('Oshawa, Ontario open data: 200 datasets and 150 maps - CanQuery');
        const short = seo.placeMeta({ id: 'p', slug: 'ajax-on', kind: 'municipality', name_en: 'Ajax', dataset_count: 20, mappable_dataset_count: 9, ancestors }, [],
            { facets: { total: 20, facets: { level: [{ value: 'municipal', count: 20 }], access: [] } } });
        expect(short.description).toBe('20 open datasets for Ajax, Ontario: 20 municipal; 9 with maps. Publishers, portals, popular tables and guides on CanQuery.');
        expect(seo.facetCount(facets, 'access', 'queryable')).toBe(40);
        expect(seo.facetCount(facets, 'level', 'federal')).toBe(0);
        expect(seo.facetCount(null, 'level', 'federal')).toBe(0);
        const noLevels = seo.placeMeta({ id: 'p', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa', type_en: 'City',
            dataset_count: 200, mappable_dataset_count: 150, ancestors }, [], { facets: { total: 200, facets: { level: [], access: [] } } });
        expect(noLevels.description).toContain('(City): 150 with interactive maps.');
    });

    it('describes the About page without repeating the site name', () => {
        const meta = seo.staticMeta('about');
        expect(meta.title).toBe('About CanQuery: search and explore Canadian open data');
        expect(meta.title.match(/CanQuery/g)).toHaveLength(1);
    });

    it('describes the About page as an AboutPage of the CanQuery organization, with a breadcrumb', () => {
        const [about, breadcrumb] = seo.staticMeta('about').jsonLd;
        expect(about).toMatchObject({ '@type': 'AboutPage', url: 'https://canquery.com/about',
            about: { '@type': 'Organization', name: 'CanQuery', logo: 'https://canquery.com/android-chrome-512.png' } });
        expect(breadcrumb['@type']).toBe('BreadcrumbList');
        expect(breadcrumb.itemListElement.map(item => item.item)).toEqual(['https://canquery.com/', 'https://canquery.com/about']);
        expect(seo.staticMeta('faq').jsonLd).toBeUndefined();
    });
});
