const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { getSearchGrowthReportData, replaceSearchConsoleDay } = require('../db/searchConsoleQueries');
const { getOrganizationByName } = require('../db/catalogReadQueries');
const { classifySearchIntent, searchIntentSql } = require('../services/searchIntent');

const databaseUrl = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe('search visibility PostgreSQL integration', () => {
    let admin;
    let db;
    const schema = 'search_test_' + process.pid + '_' + Date.now();
    const org = schema + '_org';
    const migration = name => fs.readFileSync(path.join(__dirname, '../sql/migrations', name), 'utf8');

    beforeAll(async () => {
        admin = new Pool({ connectionString: databaseUrl });
        await admin.query('CREATE SCHEMA ' + schema);
        db = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
        await db.query(migration('011_search_console.sql'));
        await db.query(migration('031_search_console_query_pages.sql'));
    });

    afterAll(async () => {
        if (admin) {
            await admin.query('DELETE FROM resources WHERE dataset_id IN (SELECT id FROM datasets WHERE org_id = $1)', [org]);
            await admin.query('DELETE FROM datasets WHERE org_id = $1', [org]);
            await admin.query('DELETE FROM organizations WHERE id = $1', [org]);
            await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
        }
        if (db) await db.end();
        if (admin) await admin.end();
    });

    test('classifies queries identically in JavaScript and PostgreSQL', async () => {
        const values = [null, '', ' ', '\t\n', '\uFEFF', '\u00a0', 'CANQUERY', 'Can Query roads',
            'site :canquery.com', 'website:roads', 'canquery github', 'api data', 'éCan Queryé',
            'water quality', '"1f3f08ee-5c60-4c8d-8b70-bd5f0350f5e8" csv',
            'abcd12345678901234567890', 'canquery_road', 'canquery api docs'];
        const result = await db.query('SELECT value, ' + searchIntentSql('value') +
            ' AS intent FROM unnest($1::text[]) AS value', [values]);
        expect(result.rows.map(row => row.intent)).toEqual(values.map(classifySearchIntent));
    });

    test('filters before report caps and counts full distinct query totals independently of query-page pairs', async () => {
        const metric = { clicks: 0, impressions: 100, ctr: 0, position: 5 };
        const diagnostic = Array.from({ length: 300 }, (_, i) => ({
            dimension: 'query', value: 'site:canquery.com probe ' + i, ...metric
        }));
        const semantic = Array.from({ length: 30 }, (_, i) => ({
            dimension: 'query', value: 'water quality ' + i, ...metric, impressions: 10
        }));
        const data = {
            dataDate: '2026-09-01', searchType: 'web',
            total: { ...metric, clicks: 4, impressions: 50000 },
            breakdowns: [...diagnostic, ...semantic, { dimension: 'query', value: 'canquery', ...metric }],
            queryPages: [...diagnostic, ...semantic].map(row => ({
                query: row.value, page: 'https://canquery.com/datasets/roads', ...metric,
                impressions: row.impressions
            }))
        };
        data.queryPages.push({ query: semantic[0].value, page: 'https://canquery.com/resources/roads', ...metric });
        await replaceSearchConsoleDay(data, db);
        await replaceSearchConsoleDay({ ...data, dataDate: '2026-09-02', queryPages: [] }, db);
        const report = await getSearchGrowthReportData(db);
        expect(report.topQueries).toHaveLength(25);
        expect(report.zeroClickQueries).toHaveLength(25);
        expect(report.queryPageOpportunities).toHaveLength(31);
        expect(report.topQueries.every(row => row.intent === 'semantic')).toBe(true);
        expect(report.brandQueries).toHaveLength(1);
        expect(report.queryIntentSummary.find(row => row.intent === 'semantic')).toMatchObject({
            queries: 30, clicks: 0, impressions: 600
        });
        expect(report.queryIntentSummary.find(row => row.intent === 'diagnostic').queries).toBe(300);
        expect(report.summary.current_impressions).toBe(100000);
    });

    test('reruns migration 031 without losing query pairs or uniqueness', async () => {
        const before = await db.query('SELECT count(*)::int AS n FROM search_console_query_pages');
        await db.query(migration('031_search_console_query_pages.sql'));
        await db.query(migration('031_search_console_query_pages.sql'));
        expect((await db.query('SELECT count(*)::int AS n FROM search_console_query_pages')).rows).toEqual(before.rows);
        await expect(db.query(`INSERT INTO search_console_query_pages
            (data_date, search_type, query_text, page_url)
            SELECT data_date, search_type, query_text, page_url FROM search_console_query_pages LIMIT 1`))
            .rejects.toMatchObject({ code: '23505' });
        const indexes = await db.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [schema]);
        expect(indexes.rows.map(row => row.indexname)).toEqual(expect.arrayContaining([
            'idx_search_console_query_pages_type_date', 'idx_search_console_query_pages_page_date'
        ]));
    });

    test('counts publisher dataset capabilities once despite multiple qualifying resources', async () => {
        await admin.query('INSERT INTO organizations (id, name, title_en) VALUES ($1, $1, $1)', [org]);
        await admin.query(`INSERT INTO datasets (id, name, title_en, org_id)
            VALUES ($1, $1, 'Roads', $3), ($2, $2, 'Downloads', $3)`, [org + '_d1', org + '_d2', org]);
        for (const id of [org + '_r1', org + '_r2']) {
            await admin.query(`INSERT INTO resources (id, dataset_id, format, url, datastore_active)
                VALUES ($1, $2, 'CSV', 'https://example.test/data.csv', true)`, [id, org + '_d1']);
            await admin.query(`INSERT INTO resource_maps (resource_id, provider, service_url, geometry_type)
                VALUES ($1, 'arcgis', 'https://example.test/FeatureServer/0', 'point')`, [id]);
        }
        expect(await getOrganizationByName(org, admin)).toMatchObject({
            name: org, dataset_count: 2, queryable_dataset_count: 1, mappable_dataset_count: 1
        });
        expect(await getOrganizationByName(org + '_missing', admin)).toBeNull();
    });

    test('groups both blog locales without including similarly named routes', async () => {
        const metric = { clicks: 0, impressions: 60, ctr: 0, position: 5 };
        const pages = ['/blog', '/fr/blog', '/blog/oshawa-parks-map', '/fr/blog/carte-parcs-oshawa', '/blogger'];
        await replaceSearchConsoleDay({
            dataDate: '2026-09-03', searchType: 'web', total: { ...metric, impressions: 300 },
            breakdowns: pages.map(page => ({ dimension: 'page', value: 'https://canquery.com' + page, ...metric })),
            queryPages: []
        }, db);
        const report = await getSearchGrowthReportData(db);
        expect(report.routes.find(row => row.value === 'Local guides')).toMatchObject({
            pages_with_impressions: 4, impressions: 240
        });
        expect(report.pageOpportunities.map(row => row.value)).toEqual(expect.arrayContaining([
            'https://canquery.com/blog/oshawa-parks-map', 'https://canquery.com/fr/blog/carte-parcs-oshawa'
        ]));
        expect(report.pageOpportunities.map(row => row.value)).not.toContain('https://canquery.com/blogger');
    });

    test('applies explicit comparison dates to totals and every current-period breakdown', async () => {
        for (const [date, query, clicks, impressions] of [
            ['2026-08-01', 'prior water data', 7, 100],
            ['2026-10-01', 'current water data', 13, 200]
        ]) {
            const metric = { clicks, impressions, ctr: clicks / impressions, position: 5 };
            await replaceSearchConsoleDay({
                dataDate: date, searchType: 'web', total: metric,
                breakdowns: [{ dimension: 'query', value: query, ...metric },
                    { dimension: 'page', value: 'https://canquery.com/datasets/' + date, ...metric }],
                queryPages: [{ query, page: 'https://canquery.com/datasets/' + date, ...metric }]
            }, db);
        }
        const report = await getSearchGrowthReportData(db, {
            startDate: '2026-10-01', endDate: '2026-10-01',
            comparisonStartDate: '2026-08-01', comparisonEndDate: '2026-08-01'
        });
        expect(report.summary).toMatchObject({ current_clicks: 13, prior_clicks: 7,
            current_impressions: 200, prior_impressions: 100, current_days: 1, prior_days: 1 });
        expect(report.topQueries.map(row => row.value)).toEqual(['current water data']);
        expect(report.topPages.map(row => row.value)).toEqual(['https://canquery.com/datasets/2026-10-01']);
        expect(report.queryIntentSummary.find(row => row.intent === 'semantic')).toMatchObject({ queries: 1, clicks: 13 });
        const historical = await getSearchGrowthReportData(db, { startDate: '2026-08-01', endDate: '2026-08-01' });
        expect(historical.topQueries.map(row => row.value)).toEqual(['prior water data']);
        expect(historical.daily.every(row => row.data_date <= '2026-08-01')).toBe(true);
    });
});
