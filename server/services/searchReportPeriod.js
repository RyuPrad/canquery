const { validateDate, addDays } = require('./searchConsoleService');

const daysBetween = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

function resolveReportPeriod(latestDate, options = {}) {
    if (!latestDate) return null;
    const endDate = validateDate(options.endDate || latestDate, 'report end');
    const startDate = validateDate(options.startDate || addDays(endDate, -27), 'report start');
    const days = daysBetween(startDate, endDate);
    if (days < 1 || days > 90) throw new Error('Report period must contain 1 to 90 days');
    if (endDate > latestDate) throw new Error('Report end exceeds the latest imported finalized date');
    if (Boolean(options.comparisonStartDate) !== Boolean(options.comparisonEndDate)) {
        throw new Error('Supply both comparison dates');
    }
    const comparisonEndDate = validateDate(options.comparisonEndDate || addDays(startDate, -1), 'comparison end');
    const comparisonStartDate = validateDate(options.comparisonStartDate || addDays(comparisonEndDate, 1 - days), 'comparison start');
    if (comparisonEndDate >= startDate || daysBetween(comparisonStartDate, comparisonEndDate) !== days) {
        throw new Error('Comparison must be an earlier, non-overlapping period of the same length');
    }
    return { startDate, endDate, comparisonStartDate, comparisonEndDate, days };
}

function validateReleaseAnnotations(value) {
    if (!Array.isArray(value) || value.length > 100) throw new Error('Release annotations must be an array of at most 100 entries');
    return value.map(entry => {
        if (!entry || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 200) {
            throw new Error('Release annotations require a label of 1 to 200 characters');
        }
        return { date: validateDate(entry.date, 'release date'), label: entry.label.trim() };
    }).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { resolveReportPeriod, validateReleaseAnnotations };
