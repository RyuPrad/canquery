const { resourcePresentation, datasetPresentation } = require('../services/catalogPresentation');
const snapshot = require('../services/seoSnapshot');

test('describes file language independently of interface language and supports maps with tables', () => {
    const row = { id: 'r', name_en: 'Dataset', name_fr: 'Ensembles de données',
        dataset_title_en: 'Ward boundaries', dataset_title_fr: 'Limites des quartiers',
        format: 'CSV', language: ['fr'], map_provider: 'arcgis', url: 'https://example.test/data.csv',
        map_fields: [{ name: 'WARD', type: 'esriFieldTypeString' }] };
    const result = resourcePresentation(row);
    expect(result.title).toEqual({ en: 'Ward boundaries (French, CSV)', fr: 'Limites des quartiers (français, CSV)' });
    expect(result.capabilities).toMatchObject({ table: 'loadable', map: true, download: true });
    expect(result.summary.fr).toContain('carte interactive');
    expect(result.fields).toMatchObject({ total: 1, source: 'map' });
    const html = snapshot.resourceSnapshot(row);
    expect(html).toContain('Ward boundaries (French, CSV)');
    expect(html).toContain('File languages');
    expect(html).toContain('French');
    expect(html).toContain('WARD');
    expect(html).toContain('Explore map');
});

test('previews at most twenty recorded fields, preferring a loaded table without inventing unknown fields', () => {
    const columns = Array.from({ length: 25 }, (_, index) => ({ id: 'field_' + index, type: 'TEXT' }));
    const p = resourcePresentation({ ingest_status: 'ready', ingested_columns: columns,
        map_fields: [{ name: 'MAP_FIELD', type: 'TEXT' }] });
    expect(p.fields).toMatchObject({ total: 25, source: 'table' });
    expect(p.fields.items).toHaveLength(20);
    expect(p.fields.items[0].name).toBe('field_0');
    expect(resourcePresentation({}).fields).toEqual({ items: [], total: 0, source: null });
    expect(snapshot.resourceSnapshot({ id: 'empty' })).not.toContain('Available fields');
    expect(resourcePresentation({ language: 'en, fr' }).languages).toEqual(['en', 'fr']);
    expect(resourcePresentation({ name_en: 'English data', language: null }).languages).toEqual([]);
});

test('preserves complete readable publisher notes and accurately counts overlapping resource capabilities', () => {
    const notes = '**History** of [contracts](https://example.test/contracts). ' + 'Detailed source notes. '.repeat(100);
    const p = datasetPresentation({ title_en: 'Contracts', notes_en: notes }, [
        { format: 'CSV', language: ['en'], ingest_status: 'ready', map_provider: 'arcgis' },
        { format: 'PDF' }
    ]);
    expect(p.description.en).toContain('History of contracts.');
    expect(p.description.en).not.toContain('https://');
    expect(p.summary.en.length).toBeLessThanOrEqual(1200);
    expect(p.description.en.length).toBeGreaterThan(p.summary.en.length);
    expect(p.capabilities).toEqual({ ready: 1, loadable: 0, mapped: 1 });
    expect(p.formats).toEqual(['CSV', 'PDF']);
});

test('escapes recorded schema and source labels and rejects unsafe source links', () => {
    const html = snapshot.resourceSnapshot({ id: 'r', map_provider: 'arcgis',
        map_fields: [{ name: 'Name & value', type: '<script>bad()</script>TEXT' }],
        provenance_sources: [{ name_en: 'Unsafe', landing_url: 'javascript:alert(1)' },
            { name_en: 'Official & source', landing_url: 'https://example.test/source' }] });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Name &amp; value');
    expect(html).toContain('href="https://example.test/source"');
});
