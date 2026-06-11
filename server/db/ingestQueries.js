const pool = require('./pool');

async function enqueueJob(resourceId) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO ingest_jobs (resource_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, resource_id, status, attempts, error, created_at`,
            [resourceId]
        );
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        const existing = await client.query(
            `SELECT id, resource_id, status, attempts, error, created_at FROM ingest_jobs WHERE resource_id = $1 AND status IN ('pending','running') ORDER BY id DESC LIMIT 1`,
            [resourceId]
        );
        return existing.rows[0] || null;
    } finally {
        client.release();
    }
}

async function getJobById(id) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT id, resource_id, status, attempts, error, claimed_at, finished_at, created_at FROM ingest_jobs WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    } finally {
        client.release();
    }
}

module.exports = { enqueueJob, getJobById };
