// Provincial and territorial governments publish into the federal open
// government portal, where their records declare jurisdiction 'provincial'.
// Each of these organizations (by CKAN name) belongs to one province or
// territory. A provincial record from one of them is placed there directly and
// without inheritance: the province's page lists it, while the places inside
// the province keep their own lists. Migration 047 backfilled the same table,
// and every federal sync applies it to the records it writes.
const FEDERAL_PUBLISHER_PLACES = Object.freeze({
    ab: 'sgc-pr-48', // Government of Alberta
    'bc-cb': 'sgc-pr-59', // Government of British Columbia
    mb: 'sgc-pr-46', // Government of Manitoba
    nb: 'sgc-pr-13', // Government of New Brunswick
    'nl-tnl': 'sgc-pr-10', // Government of Newfoundland and Labrador
    'ns-ne': 'sgc-pr-12', // Government of Nova Scotia
    'nwt-tno': 'sgc-pr-61', // Government of Northwest Territories
    on: 'ca-on', // Government of Ontario
    'pei-ipe': 'sgc-pr-11', // Government of Prince Edward Island
    qc: 'sgc-pr-24', // Government and Municipalities of Québec
    sk: 'sgc-pr-47', // Government of Saskatchewan
    yk: 'sgc-pr-60' // Government of Yukon
});

function federalPublisherPlace(name) {
    return typeof name === 'string' && Object.hasOwn(FEDERAL_PUBLISHER_PLACES, name)
        ? FEDERAL_PUBLISHER_PLACES[name]
        : null;
}

module.exports = { FEDERAL_PUBLISHER_PLACES, federalPublisherPlace };
