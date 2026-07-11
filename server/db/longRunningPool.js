const { createPool } = require('./poolFactory');

module.exports = createPool({ longRunning: true });
