require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { sources } = require('../config/catalogSources');
const { syncMunicipalSource } = require('../services/municipalSyncService');

async function main() {
    let failed = false;
    for (const source of sources.filter(item => item.enabled !== false)) {
        try {
            const summary = await syncMunicipalSource(source);
            console.log(JSON.stringify(summary));
        } catch (error) {
            failed = true;
            console.error(source.id + ': ' + error.message);
        }
    }
    await pool.end();
    process.exit(failed ? 1 : 0);
}

main().catch(async error => {
    console.error(error);
    try { await pool.end(); } catch {}
    process.exit(1);
});
