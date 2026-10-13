const fs = require('fs');
const path = require('path');

// The open-source edition runs with every hook inert. A private hosted-service
// extension, when installed at server/enterprise/index.js, adds accounts,
// metering and billing through these hooks. A broken extension fails closed.
const ENTRY = path.join(__dirname, '..', 'enterprise', 'index.js');
const noop = () => {};

// Every hook is a function so a process loads only the parts it uses: the
// ingest worker, for example, needs the preparation hooks and nothing else.
const COMMUNITY = Object.freeze({
    edition: 'community',
    // Express hooks run at fixed points in server/app.js.
    mountBeforeBodyParsing: noop,
    mountAfterBodyParsing: noop,
    apiMiddleware: () => [],
    // API process lifecycle: start() may return { stopMaintenance }.
    start: async () => ({}),
    close: async () => {},
    // Called inside the admission and settlement transactions, after the
    // resource and job locks, so lock order stays resource -> job -> extension.
    preparation: Object.freeze({ charge: async () => {}, settle: async () => {} }),
    // Hosted-only pages and content for initial HTML; see services/seoMeta.js.
    pages: () => ({ routes: [], overrides: {} }),
    // Hosted-only health components and their public metric names.
    health: () => ({ components: [], metrics: [] })
});

let loaded;
function extension() {
    if (!loaded) {
        const custom = fs.existsSync(ENTRY) ? require(ENTRY) : {};
        loaded = Object.freeze({ ...COMMUNITY, ...custom,
            preparation: Object.freeze({ ...COMMUNITY.preparation, ...custom.preparation }) });
    }
    return loaded;
}

// A database that already holds hosted accounts and billing must never run
// without the extension: requests would bypass metering and jobs would never
// settle their charges.
async function assertEditionMatchesDatabase(db) {
    if (extension().edition !== 'community') return;
    const { rows } = await db.query("SELECT to_regnamespace('commercial') IS NOT NULL AS hosted");
    if (rows[0]?.hosted) throw new Error('This database belongs to the hosted edition; install its extension before starting');
}

module.exports = { extension, assertEditionMatchesDatabase };
