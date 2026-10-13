// Public initial HTML for the developer journey. No catalogue reads or account data.
const { escapeHtml: escape } = require('./seoMeta');
const resource = 'ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05';
const section = (id, title, body) => '<section id="' + escape(id) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';
const link = (path, label) => '<a href="' + escape(path) + '">' + escape(label) + '</a>';
const code = value => '<pre tabindex="0" aria-label="Request example"><code>' + escape(value) + '</code></pre>';

// hosted adds the account steps, API-key headers and credit policy of a
// deployment with developer accounts; the open-source edition omits them.
function docsOverview(hosted = {}) {
    const spec = require('./openApi').createOpenApi();
    const notice = hosted.notice ? hosted.notice(spec) : '';
    const authorization = hosted.authorization ? ' \\\n  -H "Authorization: Bearer $CANQUERY_API_KEY"' : '';
    const resolve = value => value?.$ref?.startsWith('#/')
        ? value.$ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec) || {}
        : value || {};
    const parameters = operation => (operation.parameters || []).map(resolve);
    const first = 'curl "https://canquery.com/api/v1/resources/' + resource + '"' + authorization;
    const query = 'curl --get "https://canquery.com/api/v1/resources/' + resource + '/query"' + authorization + ' \\\n  --data-urlencode \'filters={"STREET_NAME":"KING"}\' \\\n  --data-urlencode \'limit=5\'';
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods)
        .filter(([method]) => ['get','post','delete','put','patch'].includes(method))
        .map(([method, op]) => ({path, method, op})));
    return (hosted.intro || '') + '<nav aria-label="Documentation sections">' + ['quickstart','workflow','preparation-example','capabilities','reference','reliability'].map((id, i) => link('#' + id, ['First request','Toronto workflow','Preparation example','Resource capabilities','Endpoint reference','Reliable integrations'][i])).join(' · ') + '</nav>' +
        section('quickstart', 'Your first API request', '<ol>' + (hosted.quickstartSteps ? hosted.quickstartSteps(spec) : '') + '<li>Read metadata before querying rows:</li></ol>' + code(first) +
            '<p>JSON successes normally contain data, pagination.nextCursor and meta. CSV exports, vector tiles, empty responses and /healthz have separate formats.' + (notice ? ' ' + notice : '') + '</p>') +
        section('workflow', 'A reporting workflow you can reuse', '<p>Discover a dataset, choose a resource, inspect its query_mode and preparation metadata, then filter the recorded fields. This example selects STREET_NAME equal to KING in Toronto’s active-permits resource.</p>' + code(query) +
            '<p>For a bounded CSV, use the same filters with /query.csv. Export starts at offset zero and includes at most 10,000 rows. Keep provenance, publisher licence and retrieval time with your report. The dataset contains active applications and permits, not a complete history.</p><p>' +
            link('/datasets/toronto-open-data-building-permits-active-permits', 'Toronto active building permits: source and context') + ' · ' +
            link('/blog/toronto-building-permits', 'Guide: active versus cleared permits and street filters') + '</p>') +
        section('preparation-example', 'Prepare a public file for a research extract', '<p>Use ECCC CABIN Yukon River resource <code>718489a5-d132-4ee9-ab6f-0e2644297b78</code>. The selected CSV is not available through the federal DataStore. CanQuery decodes the UTF-16 download, imports and hosts a table, and supports bounded requests. ECCC also provides separate CABIN tools; this is not a claim that the publisher has no other interfaces.</p><p>' +
            link('https://open.canada.ca/data/en/dataset/13564ca4-e330-40a5-9521-bfb1be767147', 'Publisher catalogue and Open Government Licence–Canada') + ' · ' +
            link('https://cabin-rcba.ec.gc.ca/Cabin/opendata/cabin_benthic_data_mda09_1987-present.csv', 'Original CSV') + ' · ' +
            link('https://www.canada.ca/en/environment-climate-change/services/canadian-aquatic-biomonitoring-network/database.html', 'Publisher database tools') + '</p>' +
            '<ol><li>GET resource metadata. If a current prepared table exists, continue to the query.</li><li>For an eligible unprepared or stale resource, POST /prepare.</li><li>For a 202 response, poll its job serially at least three seconds apart, honour Retry-After and stop at done or failed. Stop locally after ten minutes and retain the job ID; this does not fail or cancel shared work.</li><li>Re-read metadata for the schema, freshness and preparation timestamp.</li><li>GET /query with <code>filters={&quot;Year/Année&quot;:2024,&quot;Family/Famille&quot;:&quot;Chironomidae&quot;}</code>, <code>sort=_id asc</code> and <code>limit=10</code>.</li></ol>' +
            '<p>The example counts matching records, not individual organisms or water quality. You still interpret taxonomy, coverage and publisher-specific values. Preserve publisher modification, preparation and retrieval dates as separate events. Enable JavaScript for runnable curl, Python and Node.js recipes and the verified result excerpt.</p>' + (hosted.preparationCosts ? hosted.preparationCosts() : '')) +
        section('capabilities', 'Check what a resource supports', '<ul><li>datastore: live upstream rows and equality filters; no aggregation.</li><li>ingested: prepared local rows, recorded-column filters, aggregation and whole-file profiles.</li><li>ingestable: eligible file; explicitly request /prepare, poll the returned job, then re-read metadata.</li><li>file-only: use the original download. Map capability is separate.</li></ul><p>Preparation can return 200 for a current copy or 202 with shared work. Limits and publisher availability apply. /ingest remains a legacy compatibility endpoint and does not refresh a ready copy.</p>') +
        section('reference', 'Endpoint reference', '<p>' + link('/api/v1/openapi.json', 'Download OpenAPI 3.1: typed parameters, response schemas and examples') +
            '. Enable JavaScript for searchable parameters and code examples.</p><p>' + link('/blog/uxbridge-ward-boundaries-map', 'Map example: Uxbridge ward boundaries and GIS downloads') + '</p>' + operations.map(({path, method, op}) => '<details id="' + escape(op.operationId) + '"><summary><code>' +
                escape(method.toUpperCase() + ' ' + (path === '/healthz' ? '' : '/api/v1') + path) + '</code> — ' + escape(op.summary) +
                '</summary><p>' + escape(op.description || '') + '</p>' + (parameters(op).length ? '<div class="overflow-x-auto" tabindex="0" aria-label="Endpoint parameters"><table><thead><tr><th scope="col">Parameter</th><th scope="col">Location</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Description</th></tr></thead><tbody>' + parameters(op).map(param => '<tr><th scope="row"><code>' + escape(param.name) + '</code></th><td>' + escape(param.in) + '</td><td>' + escape([].concat(resolve(param.schema).type || '—').join(' | ')) + '</td><td>' + (param.required ? 'Yes' : 'No') + '</td><td>' + escape(param.description || '') + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</details>').join('')) +
        section('reliability', 'Operate reliably', '<p>Catalogue lists use the returned nextCursor offset string until null. Row queries use limit/offset and data.total; separate requests do not guarantee one unchanged snapshot. Local filters use exact recorded columns and combine with AND. CSV exports are capped; discard partial output after a failed stream.</p>' + (hosted.reliability ? hosted.reliability() : '<p>Distinguish PREPARATION_BUSY, PREPARATION_COOLDOWN and AUTOMATED_CLIENT. Honour Retry-After and bound retries; do not repeatedly retry unsupported files. Include X-Request-Id when contacting support.</p>') + '<p>Publisher modification time, preparation time and retrieval time differ. Copies may expire, upstream files may change, and there is no scheduled-refresh guarantee.</p>');
}

module.exports = { docsOverview };
