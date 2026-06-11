require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { packageSearch, packageShow, packageList, organizationList, datastoreSearch } = require('../services/ckanClient');

async function main() {
    try {
        const searchResult = await packageSearch({ q: 'housing', rows: 1 });
        if (typeof searchResult.count !== 'number' || searchResult.count <= 0 || !Array.isArray(searchResult.results) || searchResult.results.length !== 1) {
            throw new Error('package_search validation failed');
        }
        console.log('PASS package_search count=' + searchResult.count);

        const firstPkg = searchResult.results[0];
        const showResult = await packageShow(firstPkg.id);
        if (!showResult.title_translated) {
            throw new Error('package_show validation failed');
        }
        console.log('PASS package_show name=' + showResult.name);

        let resourceId = null;
        for (const res of showResult.resources || []) {
            if (res.datastore_active === true) {
                resourceId = res.id;
                break;
            }
        }
        if (!resourceId) {
            resourceId = '1d15a62f-5656-49ad-8c88-f40ce689d831';
        }

        const dsResult = await datastoreSearch({ resourceId: resourceId, limit: 2 });
        if (!Array.isArray(dsResult.records) || !Array.isArray(dsResult.fields)) {
            throw new Error('datastore_search validation failed');
        }
        console.log('PASS datastore_search total=' + dsResult.total);

        const orgList = await organizationList({ limit: 2, allFields: true });
        if (!Array.isArray(orgList)) {
            throw new Error('organization_list validation failed');
        }
        console.log('PASS organization_list');

        const pkgList = await packageList({ limit: 3 });
        if (!Array.isArray(pkgList) || pkgList.length !== 3) {
            throw new Error('package_list validation failed');
        }
        console.log('PASS package_list');

        console.log('SMOKE OK');
        process.exit(0);
    } catch (err) {
        console.log('FAIL ' + err.message);
        process.exit(1);
    }
}

main();
