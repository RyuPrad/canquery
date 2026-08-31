const {
    classifyResource,
    computeQueryMode,
    isIngestableFile
} = require('../services/resourceCapabilities');

describe('resource capability classification', () => {
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
