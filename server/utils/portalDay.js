// The portal directory prints the day a portal was last read. A day needs a
// time zone: in UTC every evening in Canada would already show tomorrow's
// date. Eastern time is where most readers and the federal portal are; the
// application formats with the same zone (client/src/utils/portals.js), so the
// server's page and the application's say the same day. No database.
const PORTALS_TIME_ZONE = 'America/Toronto';
const format = new Intl.DateTimeFormat('en-CA', { timeZone: PORTALS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// 2026-11-15 for a time on that day in the page's time zone; '' for no time.
function dayOf(value) {
    if (value == null || value === '') return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(format.formatToParts(date).map(part => [part.type, part.value]));
    return parts.year + '-' + parts.month + '-' + parts.day;
}

module.exports = { PORTALS_TIME_ZONE, dayOf };
