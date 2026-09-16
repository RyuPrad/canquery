const { resourceVersion, preparationInfo } = require('../services/resourceVersion');
const source = { id: 'a', url: 'https://example.org/data.csv', format: 'CSV', last_modified: '2026-09-01', raw: { hash: 'abc' } };

test('titles and sync timestamps do not make a prepared file stale', () => {
    expect(resourceVersion({ ...source, name_en: 'Revised title', synced_at: new Date(), raw: { ...source.raw, description: 'new' } }))
        .toBe(resourceVersion(source));
    expect(resourceVersion({ ...source, format: 'csv', last_modified: new Date('2026-09-01') })).toBe(resourceVersion(source));
});

test.each([
    { url: 'https://example.org/new.csv' }, { format: 'XLSX' }, { size_bytes: 200 },
    { last_modified: '2026-09-02' }, { raw: { hash: 'def' } }, { raw: { record_count: 600 } },
    { raw: { data_processed: '2026-09-02' } }
])('a source revision changes the preparation version: %j', change => {
    expect(resourceVersion({ ...source, ...change })).not.toBe(resourceVersion(source));
});

test('legacy, current and changed snapshots have distinct freshness states', () => {
    expect(preparationInfo(source).freshness).toBe('unprepared');
    const ready = { ...source, ingest_status: 'ready' };
    expect(preparationInfo(ready).freshness).toBe('unknown');
    expect(preparationInfo({ ...ready, ingested_source_version: resourceVersion(source) }).freshness).toBe('current');
    expect(preparationInfo({ ...ready, ingested_source_version: 'old' }).freshness).toBe('stale');
});
