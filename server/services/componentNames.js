const { extension } = require('../extensions');

// Public component and metric names. Kept apart from the health checks so the
// OpenAPI builder can describe them without loading the database pool.
// Hosted components (for example commercial backlogs) sit between sources and backups.
function componentNames() {
    return ['availability', 'preparation', 'maps', 'sources', ...extension().health().components, 'backups', 'storage'];
}
const METRICS = ['service_active', 'database_ready', 'eligible_pending', 'running',
    'stale_running', 'oldest_pending_seconds', 'failed_resources', 'failed_jobs', 'stale_jobs',
    'capacity_failures_last_hour', 'last_attempt_ok', 'attempt_in_progress', 'last_attempt_age_seconds',
    'latest_success_age_seconds', 'free_bytes', 'operating_margin_bytes', 'emergency_floor_bytes'];
const metricNames = () => new Set([...METRICS, ...extension().health().metrics]);

module.exports = { componentNames, metricNames };
