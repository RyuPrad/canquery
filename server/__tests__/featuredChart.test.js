const { pickChartSpec } = require('../services/featuredChart');

const year = { id: 'Year', type: 'INTEGER', distinct: 35, nulls: 0, min: 1990, max: 2024 };
const measure = { id: 'temperature_departure', type: 'NUMERIC', distinct: 60, nulls: 4, min: -2, max: 3 };
const specFor = columns => pickChartSpec({ row_count: 100, columns });

describe('pickChartSpec (bounded featured previews)', () => {
    it('includes room for NULL when inspecting a complete categorical split', () => {
        expect(specFor([
            { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
            { id: 'amount', type: 'NUMERIC', distinct: 80, nulls: 0, min: 1, max: 9 }
        ])).toEqual({ kind: 'donut', groupBy: 'status', agg: 'count', limit: 7, sort: 'value' });
    });

    it('selects a named measure over time and fetches the newest 30 periods', () => {
        expect(specFor([year, measure])).toEqual({
            kind: 'line', groupBy: 'Year', agg: 'avg', aggColumn: 'temperature_departure',
            bucket: null, limit: 30, sort: 'key_desc'
        });
    });

    it('prefers a real date axis and buckets it without treating the date as a measure', () => {
        expect(specFor([
            year,
            { id: 'Observation Date', type: 'DATE', distinct: 70, nulls: 0 },
            measure
        ])).toMatchObject({ kind: 'line', groupBy: 'Observation Date', bucket: 'year', agg: 'avg' });
    });

    it('groups a shorter typed-date series by month', () => {
        expect(specFor([{ id: 'Date', type: 'TIMESTAMPTZ', distinct: 40, nulls: 0 }]))
            .toMatchObject({ kind: 'line', bucket: 'month', agg: 'count', limit: 30 });
    });

    it('limits a mid-distinct dimension to five bars and skips identifier fields', () => {
        expect(pickChartSpec({ row_count: 500, columns: [
            { id: 'department', type: 'TEXT', distinct: 14, nulls: 0 },
            { id: 'corporation_number', type: 'TEXT', distinct: 480, nulls: 0 }
        ] })).toEqual({ kind: 'bars', groupBy: 'department', agg: 'count', limit: 5, sort: 'value' });
    });

    it.each([
        ['unique small table', 10, { id: 'Category', type: 'TEXT', distinct: 10, nulls: 0 }],
        ['unique populated subset', 100, { id: 'Category', type: 'TEXT', distinct: 10, nulls: 90 }],
        ['explicit numeric codes', 100, { id: 'classification_code', type: 'INTEGER', distinct: 5, nulls: 0 }],
        ['explicit short identifier', 100, { id: 'record_id', type: 'TEXT', distinct: 5, nulls: 0 }],
        ['vague column', 100, { id: 'Column 2', type: 'TEXT', distinct: 3, nulls: 0 }]
    ])('rejects an ambiguous dimension: %s', (_name, row_count, column) => {
        expect(pickChartSpec({ row_count, columns: [column] })).toBeNull();
    });

    it.each(['Unit', 'Currency', 'CurrencyCode', 'Measurement Units', 'Unité', 'Devise'])('avoids averaging a measure when %s varies across records', unit => {
            expect(specFor([year, measure, { id: unit, type: 'TEXT', distinct: 2, nulls: 0 }]))
                .toEqual({ kind: 'line', groupBy: 'Year', agg: 'count', bucket: null, limit: 30, sort: 'key_desc' });
        });

    it('can average a named measure when a recorded unit is constant', () => {
        expect(specFor([year, measure, { id: 'Unit', type: 'TEXT', distinct: 1, nulls: 0 }]))
            .toMatchObject({ agg: 'avg', aggColumn: 'temperature_departure' });
    });

    it.each(['Currency', 'Units'])('uses counts when an unprofiled %s field has unknown variation', id => {
        const profiled = [year, measure];
        const recorded = [...profiled, { id, type: 'TEXT' }];
        expect(pickChartSpec({ row_count: 100, columns: profiled }, recorded))
            .toMatchObject({ agg: 'count' });
    });

    it.each(['value', 'data', 'Column2', 'Unknown', 'Measure', 'Q1', 'foo'])('does not invent a meaning for the numeric field %s', id => {
            expect(specFor([year, { ...measure, id }])).toMatchObject({ agg: 'count' });
            expect(specFor([{ ...measure, id }])).toBeNull();
        });

    it('does not infer a date axis merely because an amount is between 1700 and 2200', () => {
        expect(specFor([{ id: 'Amount', type: 'NUMERIC', distinct: 60, nulls: 0, min: 1800, max: 2100 }])).toBeNull();
    });

    const budgets = { id: 'multi_year_capital_project_budgets', type: 'NUMERIC', distinct: 80, nulls: 0, min: 15000, max: 9000000 };
    it.each([['after', [year, budgets]], ['before', [budgets, year]]])('averages a year-named amount listed %s the year instead of using it as a time axis', (_order, columns) => {
        expect(specFor(columns)).toEqual({
            kind: 'line', groupBy: 'Year', agg: 'avg', aggColumn: 'multi_year_capital_project_budgets',
            bucket: null, limit: 30, sort: 'key_desc'
        });
    });

    it.each([['Month', 12], ['Quarter', 4], ['Mois', 12], ['Trimestre', 4]])('keeps the year axis when %s numbers come first', (id, max) => {
        expect(specFor([{ id, type: 'INTEGER', distinct: max, nulls: 0, min: 1, max }, year, measure]))
            .toMatchObject({ kind: 'line', groupBy: 'Year', agg: 'avg', aggColumn: 'temperature_departure' });
    });

    it('still reads a year recorded as text as a time axis', () => {
        expect(specFor([{ id: 'Fiscal Year', type: 'TEXT', distinct: 10, nulls: 0 }]))
            .toEqual({ kind: 'line', groupBy: 'Fiscal Year', agg: 'count', bucket: null, limit: 30, sort: 'key_desc' });
    });

    it('retains a descriptive integer measure with many distinct values', () => {
        expect(pickChartSpec({ row_count: 500, columns: [
            year,
            { id: 'Population', type: 'INTEGER', distinct: 490, nulls: 0, min: 3000, max: 900000 }
        ] })).toMatchObject({ kind: 'line', agg: 'avg', aggColumn: 'Population' });
    });

    it('recognizes a named rate with separators and accented year names', () => {
        expect(specFor([
            { ...year, id: 'Année' },
            { ...measure, id: 'Interest_Rate' }
        ])).toMatchObject({ kind: 'line', groupBy: 'Année', aggColumn: 'Interest_Rate' });
    });

    it('returns null when there is no meaningful grouping or resource', () => {
        expect(pickChartSpec({ row_count: 1000, columns: [
            { id: 'id', type: 'INTEGER', distinct: 1000, nulls: 0 },
            { id: 'full_name', type: 'TEXT', distinct: 999, nulls: 0 }
        ] })).toBeNull();
        expect(pickChartSpec(null)).toBeNull();
    });
});
