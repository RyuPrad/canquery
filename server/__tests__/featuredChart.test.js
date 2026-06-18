const { pickChartSpec } = require('../services/featuredChart');

describe('pickChartSpec (hero featured charts)', () => {
    it('prefers a donut for a low-distinct categorical column', () => {
        const spec = pickChartSpec({ row_count: 100, columns: [
            { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
            { id: 'amount', type: 'NUMERIC', distinct: 80, nulls: 0, min: 1, max: 9 }
        ] });
        expect(spec).toMatchObject({ kind: 'donut', groupBy: 'status', agg: 'count' });
    });

    it('uses a line over a time axis with a measure', () => {
        const spec = pickChartSpec({ row_count: 75, columns: [
            { id: 'Year', type: 'TEXT', distinct: 75, nulls: 0 },
            { id: 'temperature_departure', type: 'NUMERIC', distinct: 60, nulls: 4, min: -2, max: 3 }
        ] });
        expect(spec).toMatchObject({ kind: 'line', groupBy: 'Year', agg: 'avg', aggColumn: 'temperature_departure' });
    });

    it('falls back to bars for a mid-distinct dimension, skipping identifiers', () => {
        const spec = pickChartSpec({ row_count: 500, columns: [
            { id: 'department', type: 'TEXT', distinct: 14, nulls: 0 },
            { id: 'corporation_number', type: 'TEXT', distinct: 480, nulls: 0 }
        ] });
        expect(spec).toMatchObject({ kind: 'bars', groupBy: 'department', agg: 'count' });
    });

    it('returns null when there is nothing chartable', () => {
        const spec = pickChartSpec({ row_count: 1000, columns: [
            { id: 'id', type: 'INTEGER', distinct: 1000, nulls: 0 },
            { id: 'full_name', type: 'TEXT', distinct: 999, nulls: 0 }
        ] });
        expect(spec).toBeNull();
    });
});
