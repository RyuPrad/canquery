const { Pool } = require('pg');
const pool = new Pool({
    // CANQUERY_DATABASE_URL is canonical; OPENCANADA_DATABASE_URL kept for prod .env until migrated.
    connectionString: process.env.CANQUERY_DATABASE_URL || process.env.OPENCANADA_DATABASE_URL
});
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err.message);
});
module.exports = pool;
