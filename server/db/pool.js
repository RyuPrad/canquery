const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.OPENCANADA_DATABASE_URL
});
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err.message);
});
module.exports = pool;
