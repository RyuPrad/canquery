// Hosted canquery.com additions to the developer journey's initial HTML: the
// pricing page, and the account, API-key and credit content of /docs.
const { escapeHtml: escape } = require('../services/seoMeta');
const { config, PLANS, CREDIT_COSTS, WORKFLOW_COSTS, BUSINESS_PRICE } = require('./services/commercialConfig');
const section = (id, title, body) => '<section id="' + escape(id) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';
const link = (path, label) => '<a href="' + escape(path) + '">' + escape(label) + '</a>';

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

// Options for the core docsOverview(); each one restores hosted wording.
const hostedDocs = {
    intro: '<p>' + link('/pricing', 'Plans & credits') + '</p>',
    authorization: true,
    quickstartSteps: spec => '<li>' + (spec['x-authentication'].accounts_enabled ? link('/signup', 'Create and verify a Free account') : link('/pricing', 'Check account availability')) +
        '.</li><li>' + link('/account', 'Create an API key') + ' and save it in the CANQUERY_API_KEY environment variable on your server. Never expose it in a website or public repository.</li>',
    notice: spec => {
        const authentication = spec['x-authentication'];
        return !authentication.accounts_enabled
            ? 'API accounts are unavailable on this deployment; anonymous requests remain available. Key-based examples apply when accounts are enabled.'
            : authentication.anonymous_access
                ? 'Use an API key for new integrations. Anonymous compatibility is currently available.' + (authentication.api_key_required_at
                    ? ' The announced key requirement starts at ' + escape(authentication.api_key_required_at) + '.' : '')
                : 'An API key is required for metered developer routes. Health, operational status and the OpenAPI contract remain public.';
    },
    preparationCosts: () => workflowCosts(),
    reliability: () => '<p>Account keys share credits, request rates and expensive-request concurrency. X-CanQuery-Credits-Remaining includes pending reservations. Successful cached requests count. ' + creditPolicy() + ' Joining jobs and polling cost zero credits but still count toward request limits.</p><p>Distinguish QUOTA_EXCEEDED from RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY, PREPARATION_COOLDOWN and AUTOMATED_CLIENT. Honour Retry-After and bound retries; do not repeatedly retry exhausted allowances, authentication errors or unsupported files. Include X-Request-Id when contacting support.</p>'
};

module.exports = { pricingOverview, hostedDocs };
