function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function number(value, digits = 0) {
    return Number(value || 0).toLocaleString('en-CA', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });
}

function percent(value) {
    return number(Number(value || 0) * 100, 1) + '%';
}

function change(current, prior, inverse = false) {
    const a = Number(current || 0);
    const b = Number(prior || 0);
    if (b === 0) return a === 0 ? '0.0%' : 'new';
    const delta = ((a - b) / Math.abs(b)) * 100;
    const improved = inverse ? delta < 0 : delta > 0;
    return '<span class="delta ' + (improved ? 'up' : delta === 0 ? '' : 'down') + '">' +
        (delta > 0 ? '+' : '') + number(delta, 1) + '%</span>';
}

function metricCard(label, current, prior, formatter = number, inverse = false) {
    return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' +
        escapeHtml(formatter(current)) + '</strong><small>vs prior 28 days ' +
        change(current, prior, inverse) + '</small></div>';
}

function trendSvg(daily) {
    if (!daily.length) return '<p class="empty">No daily data yet.</p>';
    const width = 920;
    const height = 220;
    const pad = 24;
    const max = Math.max(1, ...daily.map(row => Number(row.clicks) || 0));
    const points = daily.map((row, index) => {
        const x = pad + index * ((width - pad * 2) / Math.max(1, daily.length - 1));
        const y = height - pad - ((Number(row.clicks) || 0) / max) * (height - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const first = escapeHtml(daily[0].data_date);
    const last = escapeHtml(daily[daily.length - 1].data_date);
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Daily Google Search clicks">' +
        '<line x1="' + pad + '" y1="' + (height - pad) + '" x2="' + (width - pad) + '" y2="' + (height - pad) + '" class="axis" />' +
        '<polyline points="' + points + '" class="trend" />' +
        '<text x="' + pad + '" y="' + (height - 4) + '">' + first + '</text>' +
        '<text x="' + (width - pad) + '" y="' + (height - 4) + '" text-anchor="end">' + last + '</text></svg>';
}

function table(title, rows, { valueLabel = 'Value', limit = 20 } = {}) {
    const body = rows.slice(0, limit).map(row => '<tr><td title="' + escapeHtml(row.value) + '">' +
        escapeHtml(row.value) + '</td><td>' + number(row.clicks) + '</td><td>' + number(row.impressions) +
        '</td><td>' + percent(row.ctr) + '</td><td>' + number(row.position, 1) + '</td></tr>').join('');
    return '<section class="panel"><h2>' + escapeHtml(title) + '</h2>' + (body
        ? '<div class="table-wrap"><table><thead><tr><th>' + escapeHtml(valueLabel) + '</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<p class="empty">No data yet.</p>') + '</section>';
}

function queryPageTable(rows, limit = 50) {
    const body = rows.slice(0, limit).map(row => '<tr><td class="text" title="' +
        escapeHtml(row.query) + '">' + escapeHtml(row.query) + '</td><td class="text" title="' +
        escapeHtml(row.page) + '">' + escapeHtml(row.page) + '</td><td>' + number(row.clicks) +
        '</td><td>' + number(row.impressions) + '</td><td>' + percent(row.ctr) + '</td><td>' +
        number(row.position, 1) + '</td></tr>').join('');
    return '<section class="panel"><h2>Query-to-page opportunities</h2>' + (body
        ? '<div class="table-wrap"><table><thead><tr><th class="text">Query</th><th class="text">Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<p class="empty">No query-to-page opportunities yet.</p>') + '</section>';
}

function routeTable(rows) {
    const body = rows.map(row => '<tr><td>' + escapeHtml(row.value) + '</td><td>' +
        number(row.pages_with_impressions) + '</td><td>' + number(row.pages_with_clicks) +
        '</td><td>' + number(row.clicks) + '</td><td>' + number(row.impressions) +
        '</td><td>' + percent(row.ctr) + '</td><td>' + number(row.position, 1) + '</td></tr>').join('');
    return '<section class="panel"><h2>Page-family visibility</h2>' + (body
        ? '<div class="table-wrap"><table><thead><tr><th>Route group</th><th>Visible pages</th><th>Pages with clicks</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<p class="empty">No page visibility data yet.</p>') + '</section>';
}

function renderSearchGrowthReport(data, generatedAt = new Date()) {
    const stale = data.lastSyncedAt && generatedAt.getTime() - new Date(data.lastSyncedAt).getTime() > 48 * 60 * 60 * 1000;
    const status = !data.latestDate ? 'No imported data' : stale ? 'Import may be stale' : 'Import current';
    const summary = data.summary;
    const metrics = summary ? [
        metricCard('Clicks', summary.current_clicks, summary.prior_clicks),
        metricCard('Impressions', summary.current_impressions, summary.prior_impressions),
        metricCard('CTR', summary.current_ctr, summary.prior_ctr, percent),
        metricCard('Average position', summary.current_position, summary.prior_position, value => number(value, 1), true)
    ].join('') : '<p class="empty">Run the Search Console import to populate this report.</p>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow,noarchive">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
        '<title>canquery search growth</title><style>' +
        ':root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#090e17;color:#e9f2ff}*{box-sizing:border-box}body{margin:0;padding:32px}main{max-width:1180px;margin:auto}h1,h2{font-family:system-ui,sans-serif}h1{margin:0;font-size:2rem}h2{font-size:1.05rem;margin:0 0 16px}.meta{color:#91a0b8;font-size:.84rem;margin:8px 0 24px}.status{display:inline-block;border:1px solid #2dd4bf55;color:#5eead4;border-radius:999px;padding:4px 9px;margin-left:8px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric,.panel{background:#111a28;border:1px solid #ffffff14;border-radius:14px;padding:18px}.metric span,.metric small{display:block;color:#91a0b8;font-size:.78rem}.metric strong{display:block;font-size:1.8rem;margin:8px 0}.delta{color:#b7c2d3}.delta.up{color:#5eead4}.delta.down{color:#ff958c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.panel{margin-top:16px;overflow:hidden}.grid .panel{margin-top:0}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{text-align:right;padding:8px;border-bottom:1px solid #ffffff10;white-space:nowrap}th:first-child,td:first-child,th.text,td.text{text-align:left;max-width:430px;overflow:hidden;text-overflow:ellipsis}th{color:#91a0b8;font-weight:600}.empty{color:#91a0b8}svg{width:100%;height:auto}.trend{fill:none;stroke:#d52b1e;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.axis{stroke:#ffffff22}svg text{fill:#91a0b8;font-size:11px}@media(max-width:800px){body{padding:18px}.metrics,.grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.metrics,.grid{grid-template-columns:1fr}}' +
        '</style></head><body><main><h1>Search growth</h1><p class="meta">Private canquery operator report. Finalized through ' +
        escapeHtml(data.latestDate || 'none') + '. Generated ' + escapeHtml(generatedAt.toISOString()) +
        '. <span class="status">' + escapeHtml(status) + '</span></p><section class="metrics">' + metrics +
        '</section><section class="panel"><h2>Daily clicks: last 90 finalized days</h2>' + trendSvg(data.daily || []) + '</section>' +
        '<div class="grid">' + table('Top queries: 28 days', data.topQueries || [], { valueLabel: 'Query' }) +
        table('Top pages: 28 days', data.topPages || [], { valueLabel: 'Page' }) + '</div><div class="grid">' +
        table('Zero-click opportunities', data.zeroClickQueries || [], { valueLabel: 'Query' }) +
        table('High-impression, low-CTR pages', data.pageOpportunities || [], { valueLabel: 'Page', limit: 50 }) +
        '</div>' + queryPageTable(data.queryPageOpportunities || []) +
        '<div class="grid">' + routeTable(data.routes || []) +
        table('Countries', data.countries || [], { valueLabel: 'Country', limit: 15 }) + '</div><div class="grid">' +
        table('Devices', data.devices || [], { valueLabel: 'Device', limit: 10 }) +
        '</div></main></body></html>';
}

module.exports = {
    escapeHtml,
    number,
    percent,
    change,
    trendSvg,
    table,
    queryPageTable,
    routeTable,
    renderSearchGrowthReport
};
