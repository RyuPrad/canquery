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

test.each([
    ['INVALID_FILE', 'invalid_file'], ['UPSTREAM_UNAVAILABLE', 'upstream_unavailable'],
    ['CAPACITY', 'capacity'], ['TEMPORARY', 'temporary'], ['private error detail', null]
])('metadata sanitizes failure category %s for only the failed current version', (failure_code, failure_reason) => {
    const job = { status: 'failed', source_version: resourceVersion(source), failure_code, retry_at: '2026-10-01' };
    expect(preparationInfo({ ...source, preparation_job: job })).toMatchObject({ state: 'failed', failure_reason });
    expect(preparationInfo({ ...source, preparation_job: { ...job, source_version: 'older' } }).failure_reason).toBeNull();
    expect(preparationInfo({ ...source, preparation_job: { ...job, status: 'pending' } }).failure_reason).toBeNull();
    expect(preparationInfo(source).failure_reason).toBeNull();
});
