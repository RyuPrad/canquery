#!/usr/bin/env node
// Operator entrypoint kept at this path for the component observer and the
// runbooks. Commercial administration belongs to the hosted extension.
const fs = require('fs');
const path = require('path');

const implementation = path.join(__dirname, '..', 'enterprise', 'scripts', 'commercial-admin.js');
if (!fs.existsSync(implementation)) {
    console.error('Commercial administration requires the hosted extension.');
    process.exit(1);
}
require(implementation);
