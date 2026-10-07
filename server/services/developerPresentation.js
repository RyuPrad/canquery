// Public initial HTML for the developer journey. No catalogue reads or account data.
const { escapeHtml: escape } = require('./seoMeta');
const { config, PLANS } = require('./commercialConfig');
const resource = 'ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05';
const section = (id, title, body) => '<section id="' + escape(id) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';
const link = (path, label) => '<a href="' + escape(path) + '">' + escape(label) + '</a>';
const code = value => '<pre tabindex="0" aria-label="Request example"><code>' + escape(value) + '</code></pre>';

function pricingOverview() {
    const { enabled, checkout, mode } = config();
    const number = value => value.toLocaleString('en-CA');
    return (enabled && mode === 'sandbox' ? '<p>Test environment. Payments here do not create real charges.</p>' : '') +
        '<p>' + link('/docs#quickstart', 'Try the example free') + '</p>' +
        section('plans', 'Start small. Add capacity when you need it.',
            '<h3>Free — CA$0</h3><p>Explore coverage and test your first integration. ' + number(PLANS.free.credits) +
            ' credits per UTC calendar month, ' + PLANS.free.rate + ' requests/minute and one API key. No payment card required.</p><p>' +
            link(enabled ? '/signup' : 'mailto:support@canquery.com', enabled ? 'Create an account' : 'Discuss your workflow') + '</p>' +
            '<h3>Business — CA$49/month</h3><p>For recurring client reports and dashboard integrations. ' + number(PLANS.business.credits) +
            ' credits per paid cycle, ' + PLANS.business.rate + ' requests/minute and five API keys. Email guidance for supported workflows, billing portal and invoices.</p>' +
            (checkout ? '<p>Renews monthly. Cancel before renewal. Applicable taxes are additional.</p><p>' + link('/account', 'Choose Business') + '</p>'
                : '<p>Coming soon. Paid signup is not open yet. Try Free or tell us about your workflow.</p><p>' + link('mailto:support@canquery.com', 'Discuss your workflow') + '</p>') +
            '<h3>Custom &amp; Enterprise</h3><p>Requirements beyond the standard service: a finite, capacity-tested allowance and separately scoped integration work, billing and commitments.</p>' +
            '<p>Hard allowance limits, no automatic overage charges and no rollover. Endpoint limits and publisher availability also apply.</p>') +
        section('example', 'A repeatable extract for a client report', '<p>Query Toronto’s active building applications and permits for one street. Preview records, export a CSV and keep the source with your report. Active records are not a complete historical series.</p><p>' +
            link('/docs#workflow', 'Follow the worked example') + '</p>') +
        section('credit-costs', 'Credits per operation', '<dl><dt>Metadata, row query or vector tile</dt><dd>1</dd><dt>Aggregate, profile, map viewport or featured preview</dt><dd>10</dd><dt>CSV export up to 10,000 rows</dt><dd>25</dd><dt>New preparation job admission</dt><dd>100</dd><dt>Existing/shared preparation, job polling or activity</dt><dd>0</dd></dl><p>Successful cached requests count. Failed requests and interrupted exports are refunded; an admitted preparation job still costs credits if its publisher file later fails.</p>') +
        section('service', 'Know what the service includes', '<p>Business includes email setup guidance and troubleshooting for supported datasets. Custom sources, normalized feeds, scheduled delivery and response-time commitments require a separate agreement. Inspect resource capabilities and preparation status; copies may expire and upstream availability varies.</p><p>Your subscription pays for hosted service access and operation. Publisher licences and attribution remain applicable. The MIT-licensed project remains available to run yourself.</p>');
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
    return '<nav aria-label="Documentation sections">' + ['quickstart','workflow','capabilities','reference','reliability'].map((id, i) => link('#' + id, ['First request','Reporting workflow','Resource capabilities','Endpoint reference','Reliable integrations'][i])).join(' · ') + '</nav>' +
        section('quickstart', 'Your first API request', '<ol><li>' + (authentication.accounts_enabled ? link('/signup', 'Create and verify a Free account') : link('/pricing', 'Check account availability')) +
            '.</li><li>' + link('/account', 'Create an API key') + ' and save it in the CANQUERY_API_KEY environment variable on your server. Never expose it in a website or public repository.</li><li>Read metadata before querying rows:</li></ol>' + code(first) +
            '<p>JSON successes normally contain data, pagination.nextCursor and meta. CSV exports, vector tiles, empty responses and /healthz have separate formats. ' + authCopy + '</p>') +
        section('workflow', 'A reporting workflow you can reuse', '<p>Discover a dataset, choose a resource, inspect its query_mode and preparation metadata, then filter the recorded fields. This example selects STREET_NAME equal to KING in Toronto’s active-permits resource.</p>' + code(query) +
            '<p>For a bounded CSV, use the same filters with /query.csv. Export starts at offset zero and includes at most 10,000 rows. Keep provenance, publisher licence and retrieval time with your report. The dataset contains active applications and permits, not a complete history.</p><p>' +
            link('/datasets/toronto-open-data-building-permits-active-permits', 'Toronto active building permits: source and context') + '</p>') +
        section('capabilities', 'Check what a resource supports', '<ul><li>datastore: live upstream rows and equality filters; no aggregation.</li><li>ingested: prepared local rows, recorded-column filters, aggregation and whole-file profiles.</li><li>ingestable: eligible file; explicitly request /prepare, poll the returned job, then re-read metadata.</li><li>file-only: use the original download. Map capability is separate.</li></ul><p>Preparation can return 200 for a current copy or 202 with shared work. Limits and publisher availability apply. /ingest remains a legacy compatibility endpoint and does not refresh a ready copy.</p>') +
        section('reference', 'Endpoint reference', '<p>' + link('/api/v1/openapi.json', 'Download OpenAPI 3.1: typed parameters, response schemas and examples') +
            '. Enable JavaScript for searchable parameters and code examples.</p>' + operations.map(({path, method, op}) => '<details id="' + escape(op.operationId) + '"><summary><code>' +
                escape(method.toUpperCase() + ' ' + (path === '/healthz' ? '' : '/api/v1') + path) + '</code> — ' + escape(op.summary) +
                '</summary><p>' + escape(op.description || '') + '</p>' + (parameters(op).length ? '<div class="overflow-x-auto" tabindex="0" aria-label="Endpoint parameters"><table><thead><tr><th scope="col">Parameter</th><th scope="col">Location</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Description</th></tr></thead><tbody>' + parameters(op).map(param => '<tr><th scope="row"><code>' + escape(param.name) + '</code></th><td>' + escape(param.in) + '</td><td>' + escape([].concat(resolve(param.schema).type || '—').join(' | ')) + '</td><td>' + (param.required ? 'Yes' : 'No') + '</td><td>' + escape(param.description || '') + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</details>').join('')) +
        section('reliability', 'Operate reliably', '<p>Catalogue lists use the returned nextCursor offset string until null. Row queries use limit/offset and data.total; separate requests do not guarantee one unchanged snapshot. Local filters use exact recorded columns and combine with AND. CSV exports are capped; discard partial output after a failed stream.</p><p>Account keys share credits, request rates and expensive-request concurrency. X-CanQuery-Credits-Remaining includes pending reservations. Successful cached requests count. New preparation admission costs 100 credits even if the file later fails; joining jobs and polling cost zero credits but still count toward request limits.</p><p>Distinguish QUOTA_EXCEEDED from RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY and PREPARATION_COOLDOWN. Honour Retry-After and bound retries; do not repeatedly retry exhausted allowances, authentication errors or unsupported files. Include X-Request-Id when contacting support.</p><p>Publisher modification time, preparation time and retrieval time differ. Copies may expire, upstream files may change, and there is no scheduled-refresh guarantee.</p>');
}

module.exports = { pricingOverview, docsOverview };
