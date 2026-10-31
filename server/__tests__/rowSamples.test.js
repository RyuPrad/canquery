const { cellText, clampSample, fromDatastore, fromPreview, fromPrepared, renderSampleTable,
    SAMPLE_ROWS, SAMPLE_COLUMNS, CELL_CHARS, STORED_JSON_BYTES, TABLE_HTML_BYTES } = require('../services/rowSamples');

describe('row sample cells', () => {
    test('keep text, numbers and nulls, and strip control characters', () => {
        expect(cellText(null)).toBeNull();
        expect(cellText(undefined)).toBeNull();
        expect(cellText(42)).toBe('42');
        expect(cellText('12345678901234567890')).toBe('12345678901234567890');
        expect(cellText(' Main\tStreet\r\n North\u0000 ')).toBe('Main Street North');
        expect(cellText({ a: 1 })).toBe('{"a":1}');
    });

    test('print a DATE by its local day and a TIMESTAMPTZ as an instant', () => {
        expect(cellText(new Date(2024, 0, 31), 'DATE')).toBe('2024-01-31');
        expect(cellText(new Date('2024-01-31T15:04:05Z'), 'TIMESTAMPTZ')).toBe('2024-01-31T15:04:05.000Z');
        expect(cellText(new Date('nope'), 'DATE')).toBeNull();
    });

    test('cut long values on whole characters', () => {
        const long = '😀'.repeat(CELL_CHARS + 5);
        const cut = cellText(long);
        expect(Array.from(cut)).toHaveLength(CELL_CHARS);
        expect(cut.endsWith('…')).toBe(true);
        expect(cellText('x'.repeat(CELL_CHARS))).toHaveLength(CELL_CHARS);
    });
});

describe('row sample shapes', () => {
    test('a live table drops CKAN\'s own columns and labels fields from its data dictionary', () => {
        const sample = fromDatastore({
            fields: [{ id: '_id', type: 'int' }, { id: 'ward', type: 'text', info: { label: 'Ward name' } }, { id: 'n', type: 'numeric' }, { id: '_full_text', type: 'tsvector' }],
            records: [{ _id: 1, ward: 'Rideau', n: '3.5', _full_text: 'x' }, { _id: 2, ward: null, n: 4 }],
            total: 1234
        });
        expect(sample).toEqual({
            fields: [{ id: 'ward', label: 'Ward name', type: 'text' }, { id: 'n', label: 'n', type: 'numeric' }],
            records: [['Rideau', '3.5'], [null, '4']], columns_total: 2, upstream_total: 1234
        });
        expect(fromDatastore({ fields: [], records: [] })).toBeNull();
        expect(fromDatastore({ fields: [{ id: 'a' }], records: [] })).toBeNull();
    });

    test('a file preview keeps the publisher\'s header as the label', () => {
        expect(fromPreview({ fields: [{ id: 'Year_Annee', type: 'INTEGER', original_label: 'Year/Année' }], records: [{ Year_Annee: '2024' }] }))
            .toEqual({ fields: [{ id: 'Year_Annee', label: 'Year/Année', type: 'INTEGER' }], records: [['2024']], columns_total: 1, upstream_total: null });
    });

    test('a prepared copy drops the generated _id and formats its dates', () => {
        const sample = fromPrepared({ fields: [{ id: '_id', type: 'int' }, { id: 'day', type: 'DATE', original_label: 'Day' }],
            records: [{ _id: 1, day: new Date(2025, 5, 1) }] }, 7);
        expect(sample).toEqual({ fields: [{ id: 'day', label: 'Day', type: 'DATE' }], records: [['2025-06-01']], columns_total: 1, upstream_total: 7 });
    });

    test('keep at most the first columns and rows, and fit the stored JSON', () => {
        const fields = Array.from({ length: SAMPLE_COLUMNS + 5 }, (_, n) => ({ id: 'c' + n, label: 'c' + n, type: 'TEXT' }));
        const records = Array.from({ length: SAMPLE_ROWS + 5 }, () => fields.map(() => 'v'));
        const clamped = clampSample({ fields, records });
        expect(clamped.fields).toHaveLength(SAMPLE_COLUMNS);
        expect(clamped.records).toHaveLength(SAMPLE_ROWS);
        expect(clamped.records[0]).toHaveLength(SAMPLE_COLUMNS);
        expect(clamped.columns_total).toBe(SAMPLE_COLUMNS + 5);
        const wide = clampSample({ fields, records: records.map(row => row.map(() => '"'.repeat(CELL_CHARS))) });
        expect(Buffer.byteLength(JSON.stringify(wide))).toBeLessThanOrEqual(STORED_JSON_BYTES);
        expect(wide.records.length).toBeLessThan(SAMPLE_ROWS);
    });
});

describe('row sample table', () => {
    const sample = (overrides = {}) => ({
        fields: [{ id: 'ward', label: 'Ward <name>', type: 'text' }, { id: 'n', label: 'n', type: 'numeric' }],
        records: [['<script>alert(1)</script>', '3'], [null, '4']],
        columns_total: 2, upstream_total: 1234, origin: 'datastore', read_at: '2026-10-31T06:00:00Z', ...overrides
    });

    test('escapes labels and values and says where the rows came from', () => {
        const html = renderSampleTable(sample());
        expect(html).toContain('<section data-cq-sample="datastore"><h2>Sample rows</h2>');
        expect(html).toContain('<th scope="col">Ward &lt;name&gt;</th>');
        expect(html).toContain('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td><td>3</td>');
        expect(html).toContain('<tr><td></td><td>4</td></tr>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('The first 2 rows, as CanQuery read them from the publisher&#39;s live table on 2026-10-31. The table has 1,234 rows.');
        expect(renderSampleTable(sample({ origin: 'file', upstream_total: null, columns_total: 40 })))
            .toContain('from the start of the publisher&#39;s file on 2026-10-31. Showing 2 of 40 columns.');
        expect(renderSampleTable(sample({ origin: 'prepared', records: [['a', '1']], upstream_total: 1 })))
            .toContain('The first row, as CanQuery read it from CanQuery&#39;s prepared copy on 2026-10-31.</p>');
    });

    test('renders nothing without rows, fields or a known origin', () => {
        expect(renderSampleTable(null)).toBe('');
        expect(renderSampleTable(sample({ records: [] }))).toBe('');
        expect(renderSampleTable(sample({ fields: [] }))).toBe('');
        expect(renderSampleTable(sample({ origin: 'elsewhere' }))).toBe('');
    });

    test('drops rows from the end until the escaped HTML fits its budget', () => {
        const fields = Array.from({ length: SAMPLE_COLUMNS }, (_, n) => ({ id: 'c' + n, label: 'c' + n }));
        const records = Array.from({ length: SAMPLE_ROWS }, () => fields.map(() => '&'.repeat(CELL_CHARS)));
        const html = renderSampleTable(sample({ fields, records, columns_total: SAMPLE_COLUMNS }));
        expect(Buffer.byteLength(html)).toBeLessThanOrEqual(TABLE_HTML_BYTES);
        const rows = (html.match(/<tr>/g) || []).length - 1;
        expect(rows).toBeGreaterThan(0);
        expect(rows).toBeLessThan(SAMPLE_ROWS);
        expect(html).toContain(rows === 1 ? 'The first row,' : 'The first ' + rows + ' rows,');
    });
});
