require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { assertEditionMatchesDatabase } = require('../extensions');

const client = new Client({
    connectionString: process.env.CANQUERY_DATABASE_URL || process.env.OPENCANADA_DATABASE_URL
});

async function main() {
    await client.connect();
    await assertEditionMatchesDatabase(client);

    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
    `);

    // Core migrations ship with the open-source edition; an installed extension
    // adds its own directory. Filenames are unique across both and apply in one
    // global filename order, matching the ledger keyed by filename.
    const sources = new Map();
    for (const directory of [path.join(__dirname, '..', 'sql', 'migrations'), path.join(__dirname, '..', 'enterprise', 'sql', 'migrations')]) {
        if (!fs.existsSync(directory)) continue;
        for (const filename of fs.readdirSync(directory).filter(f => f.endsWith('.sql'))) {
            if (sources.has(filename)) throw new Error(`duplicate migration filename ${filename}`);
            sources.set(filename, path.join(directory, filename));
        }
    }
    const files = [...sources.keys()].sort();

    const { rows: applied } = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.map(r => r.filename));

    for (const filename of files) {
        if (appliedSet.has(filename)) {
            console.log(`skipped ${filename}`);
            continue;
        }

        const sql = fs.readFileSync(sources.get(filename), 'utf8');

        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
            await client.query('COMMIT');
            console.log(`applied ${filename}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`error applying ${filename}:`, err.message);
            process.exit(1);
        }
    }

    await client.end();
    process.exit(0);
}

main().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
