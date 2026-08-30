require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const { getSource } = require('../config/catalogSources');

const args = process.argv.slice(2);
function value(name) {
    const exact = args.indexOf(name);
    if (exact !== -1) return args[exact + 1];
    const pair = args.find(arg => arg.startsWith(name + '='));
    return pair ? pair.slice(name.length + 1) : null;
}

async function retryMapSource(db, sourceId, apply = false) {
    const source = getSource(sourceId);
    if (!source) throw new Error('unknown or missing --source');
    const result = await db.query(`
        SELECT count(*)::int AS failed
        FROM map_index_jobs j
        JOIN resources r ON r.id = j.resource_id
        WHERE j.status = 'failed' AND r.raw->>'source_id' = $1
    `, [source.id]);
    const failed = Number(result.rows[0].failed) || 0;
    if (!apply) {
        return { source_id: source.id, failed, apply: false };
    }
    const updated = await db.query(`
        UPDATE map_index_jobs j
        SET status = 'pending', indexed_version = NULL, attempts = 0,
            worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL,
            finished_at = NULL, error = 'map jobs manually requeued after source probe',
            next_attempt_at = now(), failure_code = NULL, updated_at = now()
        FROM resources r
        WHERE j.resource_id = r.id
          AND j.status = 'failed'
          AND r.raw->>'source_id' = $1
        RETURNING j.resource_id
    `, [source.id]);
    return { source_id: source.id, failed, requeued: updated.rowCount, apply: true };
}

async function main() {
    const sourceId = value('--source');
    const summary = await retryMapSource(pool, sourceId, args.includes('--apply'));
    console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
    main()
        .then(() => pool.end())
        .then(() => process.exit(0))
        .catch(async error => {
            console.error(error);
            try { await pool.end(); } catch {}
            process.exit(1);
        });
}

module.exports = { retryMapSource, main };
