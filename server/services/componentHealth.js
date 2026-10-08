const fs = require('node:fs/promises');
const { pingDb } = require('../db/catalogReadQueries');
const AppError = require('../utils/AppError');

const COMPONENTS = ['availability', 'preparation', 'maps', 'sources', 'commercial', 'backups', 'storage'];
const METRICS = new Set(['service_active', 'database_ready', 'mail_services_active', 'eligible_pending', 'running',
    'stale_running', 'oldest_pending_seconds', 'failed_resources', 'failed_jobs', 'stale_jobs',
    'capacity_failures_last_hour', 'expired_reservations', 'billing_retries', 'delayed_billing_events',
    'failed_mail', 'delayed_mail', 'terminal_preparation_charges', 'missing_preparation_jobs',
    'last_attempt_ok', 'latest_success_age_seconds', 'free_bytes', 'operating_margin_bytes', 'emergency_floor_bytes']);

async function readiness() {
    let db = false;
    try { db = Boolean(await pingDb()); } catch { /* Deliberately omit private database diagnostics. */ }
    return { ok: db, db };
}

function sanitizeComponent(document, component, now = Date.now()) {
    const unknown = status => ({ component, ok: false, status, observed_at: null, checks: {} });
    const observed = Date.parse(document?.generated_at);
    if (document?.version !== 1 || !Number.isFinite(observed)) return unknown('unavailable');
    if (now - observed > 180_000 || observed - now > 30_000) return unknown('stale');
    const value = document.components?.[component];
    if (!value || typeof value.ok !== 'boolean' || !['ok', 'degraded', 'unavailable'].includes(value.status) ||
        value.ok !== (value.status === 'ok')) return unknown('unavailable');
    const checks = {};
    for (const [key, metric] of Object.entries(value.checks || {})) {
        if (METRICS.has(key) && (typeof metric === 'boolean' || (typeof metric === 'number' && Number.isFinite(metric) && metric >= 0))) checks[key] = metric;
    }
    return { component, ok: value.ok, status: value.status, observed_at: new Date(observed).toISOString(), checks };
}

async function componentHealth(name) {
    const component = String(name).toLowerCase();
    if (!COMPONENTS.includes(component)) throw new AppError('Unknown health component', 404);
    const unavailable = { component, ok: false, status: 'unavailable', observed_at: null, checks: {} };
    const filename = process.env.OPS_STATUS_PATH;
    if (!filename) return unavailable;
    let file;
    try {
        file = await fs.open(filename, 'r');
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 65536) return unavailable;
        const data = Buffer.alloc(65537);
        const { bytesRead } = await file.read(data, 0, data.length, 0);
        if (bytesRead > 65536) return unavailable;
        return sanitizeComponent(JSON.parse(data.subarray(0, bytesRead).toString('utf8')), component);
    } catch { return unavailable; }
    finally { if (file) await file.close(); }
}

module.exports = { COMPONENTS, readiness, componentHealth, sanitizeComponent };
