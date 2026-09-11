const {
    classifyResource,
    computeQueryMode,
    isIngestableFile
} = require('../services/resourceCapabilities');

describe('resource capability classification', () => {
    it('offers CSV archives as downloads while preserving existing loaded tables and upstream queries', () => {
        const row = { format: 'CSV', url: 'https://www150.statcan.gc.ca/n1/tbl/csv/35100007-eng.zip?version=1' };
        expect(classifyResource(row)).toEqual({ capability: 'file-only', queryMode: 'file-only' });
        expect(classifyResource({ ...row, map_provider: 'arcgis' }).capability).toBe('mapped');
        expect(classifyResource({ ...row, ingest_status: 'ready' }).capability).toBe('ingested');
        expect(classifyResource({ ...row, datastore_active: true }).capability).toBe('datastore');
        expect(isIngestableFile({ format: 'CSV', url: 'https://example.test/file.csv?label=old.zip' })).toBe(true);
        expect(isIngestableFile({ format: 'XLSX', url: 'https://example.test/file.xlsx' })).toBe(true);
    });
    test.each([
        [{ ingest_status: 'ready', datastore_active: true, format: 'CSV' }, 'ingested', 'ingested'],
        [{ datastore_active: true, format: 'CSV' }, 'datastore', 'datastore'],
        [{ format: 'CSV', size_bytes: 1024 }, 'ingestable', 'ingestable'],
        [{ format: 'PDF', map_provider: 'arcgis' }, 'mapped', 'file-only'],
        [{ format: 'PDF' }, 'file-only', 'file-only']
    ])('classifies %# consistently for API and presentation', (row, capability, queryMode) => {
        expect(classifyResource(row)).toEqual({ capability, queryMode });
        expect(computeQueryMode(row)).toBe(queryMode);
    });

    it('keeps known oversize or over-column files out of the ingestable tier', () => {
        expect(isIngestableFile({
            format: 'CSV', size_bytes: 1024,
            raw: { record_count: 10, field_count: 121 }
        })).toBe(false);
    });
});
