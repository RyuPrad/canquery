require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { getSource } = require('../config/catalogSources');
const { syncMunicipalSource } = require('../services/municipalSyncService');

const args = process.argv.slice(2);
function value(name) {
    const exact = args.indexOf(name);
    if (exact !== -1) return args[exact + 1];
    const pair = args.find(arg => arg.startsWith(name + '='));
    return pair ? pair.slice(name.length + 1) : null;
}

async function main() {
    const sourceId = value('--source');
    const source = getSource(sourceId);
    if (!source) throw new Error('unknown or missing --source');
    const limitRaw = value('--limit');
    const limit = limitRaw == null ? null : Number(limitRaw);
    if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer');
    const summary = await syncMunicipalSource(source, { dryRun: args.includes('--dry-run'), limit });
    console.log(JSON.stringify(summary, null, 2));
}

main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async error => {
        console.error(error);
        try { await pool.end(); } catch {}
        process.exit(1);
    });
