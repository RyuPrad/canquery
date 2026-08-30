const { readFileSync } = require('fs');
const { join } = require('path');

// Re-export canonical catalog sources configuration
module.exports = require(join(__dirname, 'catalogSources.js'));
