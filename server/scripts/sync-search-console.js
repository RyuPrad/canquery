require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const queries = require('../db/searchConsoleQueries');
const { createAuthorizedClient } = require('../services/googleSearchConsoleAuth');
const { addDays, pacificDate, dateRange, syncRange } = require('../services/searchConsoleService');

function arg(name) {
    const index = process.argv.indexOf(name);
    if (index !== -1) return process.argv[index + 1];
    const entry = process.argv.find(value => value.startsWith(name + '='));
    return entry ? entry.slice(name.length + 1) : null;
}

async function main() {
    const startedAt = new Date();
    let ok = false;
    let error = null;
    let rowCount = 0;
    const dryRun = process.argv.includes('--dry-run');
    try {
        const siteUrl = process.env.GSC_SITE_URL;
        const credentialPath = process.env.GSC_OAUTH_PATH;
        if (!siteUrl) throw new Error('GSC_SITE_URL is required');
        const endDate = arg('--end') || addDays(pacificDate(), -3);
        const explicitStart = arg('--start');
        const daysArg = Number(arg('--days'));
        const latest = await queries.latestSearchConsoleDate(pool);
        const days = Number.isInteger(daysArg) && daysArg > 0 ? daysArg : (latest ? 7 : 90);
        const startDate = explicitStart || addDays(endDate, -(days - 1));
        const dates = dateRange(startDate, endDate);
        if (dryRun) {
            console.log('would sync ' + dates.length + ' finalized days from ' + startDate + ' through ' + endDate + ' (dry-run)');
            ok = true;
            return;
        }
        const auth = createAuthorizedClient(credentialPath);
        const result = await syncRange({
            db: { replaceSearchConsoleDay: day => queries.replaceSearchConsoleDay(day, pool) },
            request: options => auth.request(options),
            siteUrl,
            startDate,
            endDate,
            logger: message => console.log(message)
        });
        rowCount = result.breakdownRows + result.queryPageRows;
        if (result.truncated.length) {
            console.warn('Search Console row cap reached:', JSON.stringify(result.truncated));
        }
        console.log(
            'synced ' + result.days + ' days, ' + result.breakdownRows +
            ' breakdown rows, and ' + result.queryPageRows + ' query-page rows'
        );
        ok = true;
    } catch (err) {
        error = err.message;
        console.error('Search Console sync failed:', err.message);
    } finally {
        try {
            await pool.query(`
                INSERT INTO sync_runs (kind, started_at, finished_at, ok, resources_upserted, error)
                VALUES ('search-console', $1, $2, $3, $4, $5)
            `, [startedAt, new Date(), ok, rowCount, error || (dryRun ? 'dry-run' : null)]);
        } catch (logErr) {
            console.error('Search Console run log failed:', logErr.message);
        }
        await pool.end();
    }
    if (!ok) process.exitCode = 1;
}

main();
