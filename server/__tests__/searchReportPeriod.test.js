const { resolveReportPeriod, validateReleaseAnnotations } = require('../services/searchReportPeriod');

test('defaults to adjacent finalized 28-day periods', () => {
    expect(resolveReportPeriod('2026-09-06')).toEqual({
        startDate: '2026-08-10', endDate: '2026-09-06',
        comparisonStartDate: '2026-07-13', comparisonEndDate: '2026-08-09', days: 28
    });
});

test('supports explicit equal-length nonadjacent release cohorts', () => {
    expect(resolveReportPeriod('2026-10-15', {
        startDate: '2026-10-01', endDate: '2026-10-07',
        comparisonStartDate: '2026-08-01', comparisonEndDate: '2026-08-07'
    })).toMatchObject({ days: 7, comparisonStartDate: '2026-08-01' });
});

test.each([
    { startDate: '2026-02-30' }, { endDate: '2026-09-07' },
    { startDate: '2026-09-07' }, { startDate: '2025-01-01' },
    { comparisonEndDate: '2026-08-01' },
    { comparisonStartDate: '2026-08-10', comparisonEndDate: '2026-09-06' },
    { comparisonStartDate: '2026-08-01', comparisonEndDate: '2026-08-02' }
])('rejects misleading or impossible reporting periods: %j', options => {
    expect(() => resolveReportPeriod('2026-09-06', options)).toThrow();
});

test('validates and sorts release annotations without trusting their HTML', () => {
    expect(validateReleaseAnnotations([{ date: '2026-09-11', label: '<release>' }]))
        .toEqual([{ date: '2026-09-11', label: '<release>' }]);
    expect(() => validateReleaseAnnotations([{ date: 'bad', label: 'Release' }])).toThrow();
    expect(() => validateReleaseAnnotations([{ date: '2026-09-11', label: '' }])).toThrow();
});
