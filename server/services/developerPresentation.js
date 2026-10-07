// Public initial HTML for the developer journey. No catalogue reads or account data.
const { escapeHtml: escape } = require('./seoMeta');
const { config, PLANS, CREDIT_COSTS, WORKFLOW_COSTS, BUSINESS_PRICE } = require('./commercialConfig');
const resource = 'ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05';
const section = (id, title, body) => '<section id="' + escape(id) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';
const link = (path, label) => '<a href="' + escape(path) + '">' + escape(label) + '</a>';
const code = value => '<pre tabindex="0" aria-label="Request example"><code>' + escape(value) + '</code></pre>';

function creditPolicy() {
    return 'Successful cached requests count. Failed ordinary requests and interrupted exports return their credits. A new preparation deducts ' + CREDIT_COSTS.preparation + ' credits; a terminal failure without a result published by that job returns its actual debit once to the original allowance period. Retries retain the debit. A client timeout does not fail or cancel the shared job. A failed refresh returns its charge even if an older table remains usable. Valid empty tables count as success; later expiry or eviction does not return credits. This is an account-credit adjustment, not a cash refund.';
}
function workflowCosts() {
    return '<table><caption>Credits for the requests shown, using an existing API key</caption><thead><tr><th scope="col">Workflow</th><th scope="col">Credits</th></tr></thead><tbody>' +
        '<tr><th scope="row">Inspect a ready resource, then query rows</th><td>' + WORKFLOW_COSTS.ready + '</td></tr>' +
        '<tr><th scope="row">Inspect, admit a new preparation, poll, inspect the prepared schema, query rows</th><td>' + WORKFLOW_COSTS.prepare + '</td></tr>' +
        '<tr><th scope="row">Later inspect and query while the copy remains ready</th><td>' + WORKFLOW_COSTS.reuse + '</td></tr>' +
        '</tbody></table><p>Polling costs zero. Joining existing work reduces the complete preparation sequence to ' + (2 * CREDIT_COSTS.metadata + CREDIT_COSTS.query) +
        ' credits. A direct repeat query costs ' + WORKFLOW_COSTS.direct_query + '; an optional CSV export adds ' + WORKFLOW_COSTS.export +
        '. An aggregate instead of the cold sequence’s row query totals ' + WORKFLOW_COSTS.prepare_aggregate + '. Discovery and other additional successful requests use their own credits.</p>';
}
function pricingOverview() {
    const { enabled, checkout, mode } = config();
    const number = value => value.toLocaleString('en-CA');
    return (enabled && mode === 'sandbox' ? '<p>Test environment. Payments here do not create real charges.</p>' : '') +
        '<p>For small analytics and research consultancies producing reports and dashboards: inspect an eligible public file, let CanQuery prepare and host its table, and request the records you need.</p><p>' + link('/docs#preparation-example', 'Try the preparation example') + '</p>' +
        section('plans', 'The same supported capabilities. More room on Business.',
            '<h3>Free — CA$0</h3><p>' + number(PLANS.free.credits) + ' credits per UTC calendar month, ' + PLANS.free.rate +
            ' requests/minute, ' + PLANS.free.keys + ' API key and ' + PLANS.free.concurrency + ' concurrent expensive request. Includes eligible preparation, supported queries and bounded exports. No payment card required.</p><p>' +
            link(enabled ? '/signup' : 'mailto:support@canquery.com', enabled ? 'Create an account' : 'Discuss your workflow') + '</p>' +
            '<h3>Business — CA$' + BUSINESS_PRICE.amount / 100 + '/month</h3><p>' + number(PLANS.business.credits) +
            ' credits per paid cycle, ' + PLANS.business.rate + ' requests/minute, ' + PLANS.business.keys + ' API keys and ' + PLANS.business.concurrency +
            ' concurrent expensive requests. Business primarily adds allowance and capacity, plus a billing portal and invoices. For the first few customers, the founder offers email help to inspect one existing supported resource and get one query working.</p>' +
            '<p>Renews monthly. Cancel before renewal. Applicable taxes are additional. Cancellation takes effect at the paid period’s end; access continues until then and falls back to Free afterward.</p>' +
            (checkout ? '<p>' + link('/account', 'Choose Business') + '</p>'
                : '<p>Coming soon. Paid signup is not open yet. Try Free or tell us about your workflow.</p><p>' + link('mailto:support@canquery.com', 'Discuss your workflow') + '</p>') +
            '<p>Hard allowance limits, no automatic overage charges and no rollover. Endpoint limits and publisher availability also apply.</p>') +
        section('example', 'From a publisher CSV to a filtered extract', '<p>The ECCC CABIN Yukon River CSV uses UTF-16 and is not exposed through the federal DataStore. CanQuery handles decoding, table preparation and hosting, then returns a bounded extract using the publisher’s recorded fields. You still interpret the records and integrate them into your report.</p><p>' +
            link('/docs#preparation-example', 'Follow the preparation example') + ' · ' + link('/docs#workflow', 'Toronto permits: live DataStore quickstart') + '</p>') +
        section('credit-costs', 'Understand credits through your workflow', workflowCosts() +
            '<dl><dt>Metadata, row query or vector tile</dt><dd>' + CREDIT_COSTS.metadata + '</dd><dt>Aggregate, profile, map viewport or featured preview</dt><dd>' + CREDIT_COSTS.aggregate +
            '</dd><dt>CSV export up to 10,000 rows</dt><dd>' + CREDIT_COSTS.export + '</dd><dt>New preparation admission</dt><dd>' + CREDIT_COSTS.preparation +
            '</dd><dt>Existing/shared preparation, polling or activity</dt><dd>' + CREDIT_COSTS.activity + '</dd></dl><p>' + creditPolicy() + '</p>') +
        section('service', 'Know what the service includes', '<p>Catalogue inclusion does not guarantee a working table. Preparation supports eligible resources only. Live DataStore supports equality filters; prepared tables add supported filters and aggregates. Fields retain publisher names and meanings. Refresh is demand-driven. Unpinned copies may expire or be evicted; supported queries and exports have row limits.</p><p>The original public data remains available from its publisher. Your subscription pays for hosted service access. Publisher licences and attribution remain applicable; the MIT-licensed project can also be self-hosted.</p><p>Additional sources, standardization, scheduled updates, animated charts and enterprise guarantees are possibilities to discuss, not included commitments. ' + link('mailto:support@canquery.com', 'Tell us about another requirement') + '</p>');
}

function docsOverview() {
    const spec = require('./openApi').createOpenApi();
    const authentication = spec['x-authentication'];
    const authCopy = !authentication.accounts_enabled
        ? 'API accounts are unavailable on this deployment; anonymous requests remain available. Key-based examples apply when accounts are enabled.'
        : authentication.anonymous_access
            ? 'Use an API key for new integrations. Anonymous compatibility is currently available.' + (authentication.api_key_required_at
                ? ' The announced key requirement starts at ' + escape(authentication.api_key_required_at) + '.' : '')
            : 'An API key is required for metered developer routes. Health, operational status and the OpenAPI contract remain public.';
    const resolve = value => value?.$ref?.startsWith('#/')
        ? value.$ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec) || {}
        : value || {};
    const parameters = operation => (operation.parameters || []).map(resolve);
    const first = 'curl "https://canquery.com/api/v1/resources/' + resource + '" \\\n  -H "Authorization: Bearer $CANQUERY_API_KEY"';
    const query = 'curl --get "https://canquery.com/api/v1/resources/' + resource + '/query" \\\n  -H "Authorization: Bearer $CANQUERY_API_KEY" \\\n  --data-urlencode \'filters={"STREET_NAME":"KING"}\' \\\n  --data-urlencode \'limit=5\'';
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods)
        .filter(([method]) => ['get','post','delete','put','patch'].includes(method))
        .map(([method, op]) => ({path, method, op})));
    return '<p>' + link('/pricing', 'Plans & credits') + '</p><nav aria-label="Documentation sections">' + ['quickstart','workflow','preparation-example','capabilities','reference','reliability'].map((id, i) => link('#' + id, ['First request','Toronto workflow','Preparation example','Resource capabilities','Endpoint reference','Reliable integrations'][i])).join(' · ') + '</nav>' +
        section('quickstart', 'Your first API request', '<ol><li>' + (authentication.accounts_enabled ? link('/signup', 'Create and verify a Free account') : link('/pricing', 'Check account availability')) +
            '.</li><li>' + link('/account', 'Create an API key') + ' and save it in the CANQUERY_API_KEY environment variable on your server. Never expose it in a website or public repository.</li><li>Read metadata before querying rows:</li></ol>' + code(first) +
            '<p>JSON successes normally contain data, pagination.nextCursor and meta. CSV exports, vector tiles, empty responses and /healthz have separate formats. ' + authCopy + '</p>') +
        section('workflow', 'A reporting workflow you can reuse', '<p>Discover a dataset, choose a resource, inspect its query_mode and preparation metadata, then filter the recorded fields. This example selects STREET_NAME equal to KING in Toronto’s active-permits resource.</p>' + code(query) +
            '<p>For a bounded CSV, use the same filters with /query.csv. Export starts at offset zero and includes at most 10,000 rows. Keep provenance, publisher licence and retrieval time with your report. The dataset contains active applications and permits, not a complete history.</p><p>' +
            link('/datasets/toronto-open-data-building-permits-active-permits', 'Toronto active building permits: source and context') + ' · ' +
            link('/blog/toronto-building-permits', 'Guide: active versus cleared permits and street filters') + '</p>') +
        section('preparation-example', 'Prepare a public file for a research extract', '<p>Use ECCC CABIN Yukon River resource <code>718489a5-d132-4ee9-ab6f-0e2644297b78</code>. The selected CSV is not available through the federal DataStore. CanQuery decodes the UTF-16 download, imports and hosts a table, and supports bounded requests. ECCC also provides separate CABIN tools; this is not a claim that the publisher has no other interfaces.</p><p>' +
            link('https://open.canada.ca/data/en/dataset/13564ca4-e330-40a5-9521-bfb1be767147', 'Publisher catalogue and Open Government Licence–Canada') + ' · ' +
            link('https://cabin-rcba.ec.gc.ca/Cabin/opendata/cabin_benthic_data_mda09_1987-present.csv', 'Original CSV') + ' · ' +
            link('https://www.canada.ca/en/environment-climate-change/services/canadian-aquatic-biomonitoring-network/database.html', 'Publisher database tools') + '</p>' +
            '<ol><li>GET resource metadata. If a current prepared table exists, continue to the query.</li><li>For an eligible unprepared or stale resource, POST /prepare.</li><li>For a 202 response, poll its job serially at least three seconds apart, honour Retry-After and stop at done or failed. Stop locally after ten minutes and retain the job ID; this does not fail or cancel shared work.</li><li>Re-read metadata for the schema, freshness and preparation timestamp.</li><li>GET /query with <code>filters={&quot;Year/Année&quot;:2024,&quot;Family/Famille&quot;:&quot;Chironomidae&quot;}</code>, <code>sort=_id asc</code> and <code>limit=10</code>.</li></ol>' +
            '<p>The example counts matching records, not individual organisms or water quality. You still interpret taxonomy, coverage and publisher-specific values. Preserve publisher modification, preparation and retrieval dates as separate events. Enable JavaScript for runnable curl, Python and Node.js recipes and the verified result excerpt.</p>' + workflowCosts()) +
        section('capabilities', 'Check what a resource supports', '<ul><li>datastore: live upstream rows and equality filters; no aggregation.</li><li>ingested: prepared local rows, recorded-column filters, aggregation and whole-file profiles.</li><li>ingestable: eligible file; explicitly request /prepare, poll the returned job, then re-read metadata.</li><li>file-only: use the original download. Map capability is separate.</li></ul><p>Preparation can return 200 for a current copy or 202 with shared work. Limits and publisher availability apply. /ingest remains a legacy compatibility endpoint and does not refresh a ready copy.</p>') +
        section('reference', 'Endpoint reference', '<p>' + link('/api/v1/openapi.json', 'Download OpenAPI 3.1: typed parameters, response schemas and examples') +
            '. Enable JavaScript for searchable parameters and code examples.</p><p>' + link('/blog/uxbridge-ward-boundaries-map', 'Map example: Uxbridge ward boundaries and GIS downloads') + '</p>' + operations.map(({path, method, op}) => '<details id="' + escape(op.operationId) + '"><summary><code>' +
                escape(method.toUpperCase() + ' ' + (path === '/healthz' ? '' : '/api/v1') + path) + '</code> — ' + escape(op.summary) +
                '</summary><p>' + escape(op.description || '') + '</p>' + (parameters(op).length ? '<div class="overflow-x-auto" tabindex="0" aria-label="Endpoint parameters"><table><thead><tr><th scope="col">Parameter</th><th scope="col">Location</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Description</th></tr></thead><tbody>' + parameters(op).map(param => '<tr><th scope="row"><code>' + escape(param.name) + '</code></th><td>' + escape(param.in) + '</td><td>' + escape([].concat(resolve(param.schema).type || '—').join(' | ')) + '</td><td>' + (param.required ? 'Yes' : 'No') + '</td><td>' + escape(param.description || '') + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</details>').join('')) +
        section('reliability', 'Operate reliably', '<p>Catalogue lists use the returned nextCursor offset string until null. Row queries use limit/offset and data.total; separate requests do not guarantee one unchanged snapshot. Local filters use exact recorded columns and combine with AND. CSV exports are capped; discard partial output after a failed stream.</p><p>Account keys share credits, request rates and expensive-request concurrency. X-CanQuery-Credits-Remaining includes pending reservations. Successful cached requests count. ' + creditPolicy() + ' Joining jobs and polling cost zero credits but still count toward request limits.</p><p>Distinguish QUOTA_EXCEEDED from RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY and PREPARATION_COOLDOWN. Honour Retry-After and bound retries; do not repeatedly retry exhausted allowances, authentication errors or unsupported files. Include X-Request-Id when contacting support.</p><p>Publisher modification time, preparation time and retrieval time differ. Copies may expire, upstream files may change, and there is no scheduled-refresh guarantee.</p>');
}

module.exports = { pricingOverview, docsOverview };
