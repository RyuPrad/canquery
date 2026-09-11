require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { getSearchGrowthReportData } = require('../db/searchConsoleQueries');
const { renderSearchGrowthReport } = require('../services/searchGrowthReport');
const { validateReleaseAnnotations } = require('../services/searchReportPeriod');

async function writeAtomically(filePath, html) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
    const tmp = filePath + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, html, { encoding: 'utf8', mode: 0o640 });
    await fs.promises.rename(tmp, filePath);
}

async function main() {
    try {
        const args = process.argv.slice(2);
        const flags = ['--start', '--end', '--compare-start', '--compare-end', '--releases', '--output', '--json'];
        const values = {};
        for (let i = 0; i < args.length; i += 2) {
            if (!flags.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid report arguments');
            values[args[i]] = args[i + 1];
        }
        const outputPath = values['--output'] || process.env.GSC_REPORT_PATH;
        if (!outputPath) throw new Error('GSC_REPORT_PATH is required');
        const releasesPath = values['--releases'] || process.env.GSC_RELEASES_PATH;
        const releases = releasesPath ? validateReleaseAnnotations(JSON.parse(await fs.promises.readFile(releasesPath, 'utf8'))) : [];
        const client = await pool.connect();
        let data;
        try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            // Serialize queries on this transaction's single PostgreSQL connection.
            let pending = Promise.resolve();
            const db = { query: (...args) => {
                pending = pending.then(() => client.query(...args));
                return pending;
            } };
            data = await getSearchGrowthReportData(db, {
                startDate: values['--start'], endDate: values['--end'],
                comparisonStartDate: values['--compare-start'], comparisonEndDate: values['--compare-end']
            });
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
        data.releases = releases;
        if (values['--json']) {
            // Baselines include private query text. Never silently replace one.
            await fs.promises.writeFile(values['--json'], JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        }
        await writeAtomically(outputPath, renderSearchGrowthReport(data));
        console.log('wrote private search-growth report through ' + (data.latestDate || 'no data'));
    } catch (err) {
        console.error('Search-growth report failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
