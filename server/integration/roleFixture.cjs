// Shared by the runtime-role suites: provisions a reviewed role script against
// the disposable database and opens sessions as a runtime identity.
const fs = require('node:fs/promises');

const quoteId = value => '"' + value.replaceAll('"', '""') + '"';
const quoteValue = value => "'" + value.replaceAll("'", "''") + "'";

// psql variables become the disposable database and its owner; meta-commands
// are dropped because the script runs through the driver, not psql.
async function applyRoleScript(admin, file) {
    const { rows: [identity] } = await admin.query('SELECT current_database() AS database, current_user AS owner');
    let sql = await fs.readFile(file, 'utf8');
    sql = sql.replace(/^\\.*$/gm, '').replaceAll(':"app_database"', quoteId(identity.database))
        .replaceAll(':"deploy_role"', quoteId(identity.owner)).replaceAll(":'app_database'", quoteValue(identity.database))
        .replaceAll(":'deploy_role'", quoteValue(identity.owner));
    await admin.query(sql);
}

async function connectAs(admin, role, clients) {
    const client = await admin.connect();
    // Unlike SET ROLE alone, SESSION AUTHORIZATION also prevents a runtime
    // identity from using the original superuser's SET ROLE authority.
    await client.query('SET SESSION AUTHORIZATION ' + quoteId(role));
    clients.push(client);
    return client;
}

function dbFor(client) {
    return { query: (...args) => client.query(...args), connect: async () => ({
        query: (...args) => client.query(...args), release() {}
    }) };
}

module.exports = { applyRoleScript, connectAs, dbFor, quoteId };
