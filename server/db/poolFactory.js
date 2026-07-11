const { Pool } = require('pg');

function envInteger(name, fallback, min) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
        throw new Error(name + ' must be an integer greater than or equal to ' + min);
    }
    return value;
}

function createPool({ longRunning = false } = {}) {
    const common = {
        // CANQUERY_DATABASE_URL is canonical; OPENCANADA_DATABASE_URL remains
        // accepted until the legacy production environment is renamed.
        connectionString: process.env.CANQUERY_DATABASE_URL || process.env.OPENCANADA_DATABASE_URL,
        connectionTimeoutMillis: envInteger('DB_CONNECTION_TIMEOUT_MS', 5000, 1),
        idleTimeoutMillis: envInteger('DB_IDLE_TIMEOUT_MS', 30000, 1),
        application_name: longRunning ? 'canquery-long-running' : 'canquery-api'
    };

    const options = longRunning
        ? {
            ...common,
            // COPY and ingest DDL can legitimately outlive an HTTP query. Keep
            // this pool small and give each statement a generous but finite
            // ceiling so a lock wait or wedged COPY cannot live forever.
            max: envInteger('DB_LONG_POOL_MAX', 2, 1),
            statement_timeout: envInteger('DB_LONG_STATEMENT_TIMEOUT_MS', 30 * 60 * 1000, 1),
            query_timeout: envInteger('DB_LONG_QUERY_TIMEOUT_MS', 31 * 60 * 1000, 1)
        }
        : {
            ...common,
            // The worker process can concurrently hold its lifetime queue lock,
            // the store-budget lock, an eviction transaction, and a heartbeat.
            // Refuse a smaller pool instead of deadlocking a configured worker.
            max: envInteger('DB_POOL_MAX', 10, 4),
            statement_timeout: envInteger('DB_STATEMENT_TIMEOUT_MS', 30000, 1),
            // Slightly above the server-side limit so Postgres cancels first
            // and returns a clean timeout instead of leaving work behind.
            query_timeout: envInteger('DB_QUERY_TIMEOUT_MS', 35000, 1)
        };

    const pool = new Pool(options);
    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err.message);
    });
    return pool;
}

module.exports = { createPool };
