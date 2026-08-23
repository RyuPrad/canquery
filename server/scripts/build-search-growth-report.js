require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { getSearchGrowthReportData } = require('../db/searchConsoleQueries');
const { renderSearchGrowthReport } = require('../services/searchGrowthReport');

async function writeAtomically(filePath, html) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
    const tmp = filePath + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, html, { encoding: 'utf8', mode: 0o640 });
    await fs.promises.rename(tmp, filePath);
}

async function main() {
    try {
        const outputPath = process.env.GSC_REPORT_PATH;
        if (!outputPath) throw new Error('GSC_REPORT_PATH is required');
        const data = await getSearchGrowthReportData(pool);
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
