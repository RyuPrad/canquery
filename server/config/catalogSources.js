/**
 * CanQuery Multi-Source Catalog Configuration
 *
 * Defines all upstream open data sources synced into the CanQuery catalogue.
 * Each source specifies:
 *   - id: unique stable slug used in source_id columns
 *   - kind: adapter kind ('ckan', 'socrata', 'arcgis-hub', 'opendatasoft')
 *   - nameEn / nameFr: bilingual human-readable name of the portal
 *   - homepageUrl: user-facing portal URL
 *   - catalogUrl: machine-readable DCAT / CKAN / ODS endpoint
 *   - upstreamHost: expected upstream hostname for SSRF/download security
 *   - enabled: boolean flag
 *   - syncIntervalHours: cron sync cadence
 *   - maxDeleteFraction: safety threshold against catastrophic purge
 *   - publisherAliases: canonical mapping rules for publisher strings
 *   - authoritativePublishers: regex patterns matching authoritative orgs
 *   - licenseRules: license normalization rules
 *   - placeRules: spatial attachment rules linking records to SGC places
 */

const { getSource, getAllSources, getEnabledSources } = (() => {
    // We export helper accessors at the bottom of the file
    // after sources array is declared
})();

// Re-read file content directly into push payload
