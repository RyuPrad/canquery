const facts = require('../services/catalogFacts');

describe('dataset facts', () => {
    const dataset = { title_en: 'Water Quality', org_title_en: 'Environment Canada', metadata_modified: '2026-01-02T10:00:00Z' };

    it('counts capabilities, orders formats by frequency and detects bilingual files', () => {
        const info = facts.datasetFacts(dataset, [
            { format: 'csv', datastore_active: true, language: 'en' },
            { format: 'CSV', url: 'https://example.test/a.csv', language: 'fr' },
            { format: 'PDF', url: 'https://example.test/a.pdf' },
            { format: 'GeoJSON', url: 'https://example.test/a.geojson', map_provider: 'canquery' },
            null
        ]);
        expect(info).toMatchObject({
            title: 'Water Quality', publisher: 'Environment Canada', fileCount: 4,
            formats: ['CSV', 'GEOJSON', 'PDF'], topFormats: ['CSV', 'GEOJSON', 'PDF'],
            queryable: 1, loadable: 1, mapped: 1, downloadOnly: 1, bilingual: true,
            updated: 'Jan 2026', updatedDate: '2026-01-02'
        });
    });

    it('tolerates missing rows, dates and resources', () => {
        expect(facts.datasetFacts({}, null)).toMatchObject({ title: '', publisher: '', fileCount: 0, formats: [], bilingual: false, updated: null, updatedDate: null });
        expect(facts.datasetFacts({ metadata_modified: 'not a date' }, []).updated).toBeNull();
    });
});

describe('capability phrases', () => {
    const base = { fileCount: 0, queryable: 0, loadable: 0, mapped: 0, topFormats: [] };

    test.each([
        [{ ...base, fileCount: 1, loadable: 1, topFormats: ['CSV'] }, 'table (CSV)', 'table'],
        [{ ...base, fileCount: 1, queryable: 1, mapped: 1, topFormats: ['CSV'] }, 'live table and map (CSV)', 'live table and map'],
        [{ ...base, fileCount: 1, topFormats: ['PDF'] }, 'PDF file', 'PDF file'],
        [{ ...base, fileCount: 2, loadable: 2, topFormats: ['CSV', 'XLSX'] }, '2 tables (CSV, XLSX)', '2 tables'],
        [{ ...base, fileCount: 23, queryable: 19, topFormats: ['CSV', 'PDF'] }, '19 live tables and 23 files (CSV, PDF)', '19 live tables and 23 files'],
        [{ ...base, fileCount: 3, loadable: 1, mapped: 1, topFormats: ['CSV', 'GEOJSON', 'SHP'] }, 'table, map and 3 files (CSV, GEOJSON, SHP)', 'table, map and 3 files'],
        [{ ...base, fileCount: 12, topFormats: ['PDF'] }, '12 files (PDF)', '12 files'],
        [{ ...base, fileCount: 2, mapped: 2, topFormats: ['GEOJSON'] }, '2 maps (GEOJSON)', '2 maps'],
        [base, '', '']
    ])('phrases %o', (info, full, short) => {
        expect(facts.capabilityPhrase(info)).toBe(full);
        expect(facts.capabilityPhrase(info, { short: true })).toBe(short);
    });

    it('builds the action sentence for descriptions', () => {
        expect(facts.capabilitySentence({ queryable: 1, loadable: 0, mapped: 0 })).toBe('Preview the live table, filter, chart and export up to 10,000 rows as CSV');
        expect(facts.capabilitySentence({ queryable: 0, loadable: 2, mapped: 1 })).toBe('Explore the interactive map, open as a table, filter, chart and export up to 10,000 rows as CSV');
        expect(facts.capabilitySentence({ queryable: 0, loadable: 0, mapped: 0 })).toBe('View metadata, licence and direct download links');
    });
});

describe('resource facts and labels', () => {
    it('reads rows and fields only from a ready table or a recorded map schema', () => {
        const ready = facts.resourceFacts({ format: 'csv', ingest_status: 'ready', ingested_row_count: '42', ingested_columns: [{ id: 'a' }],
            language: 'en, fr', size_bytes: 2048, last_modified: '2026-03-04', org_title_en: 'City', dataset_title_en: 'Roads' });
        expect(ready).toMatchObject({ capability: 'ingested', table: true, loadable: false, mapped: false, format: 'CSV',
            languages: ['en', 'fr'], size: '2 KB', rows: 42, fields: 1, updated: 'Mar 2026', publisher: 'City', datasetTitle: 'Roads' });
        const mapped = facts.resourceFacts({ format: 'PDF', map_provider: 'arcgis', map_fields: [{ name: 'A' }, { name: 'B' }], ingested_row_count: 5 });
        expect(mapped).toMatchObject({ capability: 'mapped', mapped: true, rows: null, fields: 2, size: null, updated: null });
        expect(facts.capabilityWord(ready)).toBe('live table');
        expect(facts.capabilityWord(mapped)).toBe('map');
        expect(facts.capabilityWord(facts.resourceFacts({ format: 'XLSX', map_provider: 'arcgis' }))).toBe('table and map');
        expect(facts.capabilityWord(facts.resourceFacts({ format: 'PDF' }))).toBe('');
    });

    it('labels access in reader words', () => {
        expect(facts.accessLabel('ingested')).toBe('Live table (filter, chart, export)');
        expect(facts.accessLabel('datastore', { mapped: true })).toBe('Live table (filter, chart, export) and interactive map');
        expect(facts.accessLabel('ingestable')).toBe('Table on demand (prepared when opened)');
        expect(facts.accessLabel('mapped')).toBe('Interactive map and original download');
        expect(facts.accessLabel('file-only')).toBe('Original download only');
    });

    it('formats sizes, counts, dates and lists in both languages', () => {
        expect(facts.humanFileSize(1536)).toBe('1.5 KB');
        expect(facts.humanFileSize(1536, 'fr')).toBe('1.5 ko');
        expect(facts.humanFileSize(12, 'fr')).toBe('12 octets');
        expect(facts.humanFileSize(null)).toBeNull();
        expect(facts.formatCount(1234567)).toBe('1,234,567');
        expect(facts.monthYear('2026-10-02T13:00:00Z')).toBe('Oct 2026');
        expect(facts.monthYear('2026-10-02T13:00:00Z', 'fr')).toBe('oct. 2026');
        expect(facts.monthYear('nope')).toBeNull();
        expect(facts.joinList(['a'])).toBe('a');
        expect(facts.joinList(['a', 'b'])).toBe('a and b');
        expect(facts.joinList(['a', '', 'b', 'c'], 'fr')).toBe('a, b et c');
        expect(facts.plural(1, 'file')).toBe('file');
        expect(facts.plural(2, 'file')).toBe('files');
    });
});
