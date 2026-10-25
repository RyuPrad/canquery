const { envelope } = require('../utils/envelope');

// Response bodies shared by the JSON controllers and the resource page's
// embedded initial data, so a direct visit receives byte-identical envelopes
// (key order included) to the ones the browser would otherwise fetch.

// Catalogue detail reads keep the provenance block inside data.
const catalogProvenanceMeta = (value) => {
    const sources = value && value.provenance && value.provenance.sources || [];
    const primary = sources.find(source => source.authoritative) || sources[0];
    return {
        sources: sources.map(source => source.id),
        upstream: primary ? primary.upstream : null,
        license: value && value.provenance && value.provenance.primary_license
            ? value.provenance.primary_license.title.en
            : null
    };
};

// Query results repeat the provenance block in meta.
function queryProvenanceMeta(provenance) {
    const sources = provenance && Array.isArray(provenance.sources) ? provenance.sources : [];
    const primary = sources.find(source => source.authoritative) || sources[0] || null;
    return {
        provenance: provenance || { sources: [], primary_license: null },
        sources: sources.map(source => source.id),
        upstream: primary ? primary.upstream : null,
        license: provenance && provenance.primary_license ? provenance.primary_license.title.en : null
    };
}

const resourceEnvelope = (resource) => envelope(resource, { meta: catalogProvenanceMeta(resource) });
const datasetEnvelope = (dataset) => envelope(dataset, { meta: catalogProvenanceMeta(dataset) });

const queryEnvelope = (result) => envelope(
    { fields: result.fields, records: result.records, total: result.total },
    { meta: Object.assign(
        { query_mode: result.query_mode, snapshot: result.snapshot, retrieved_at: result.retrieved_at,
            publisher_modified_at: result.publisher_modified_at, limits: result.limits },
        queryProvenanceMeta(result.provenance),
        result.aggregation ? { aggregation: result.aggregation } : {}
    ) }
);

module.exports = { catalogProvenanceMeta, queryProvenanceMeta, resourceEnvelope, datasetEnvelope, queryEnvelope };
