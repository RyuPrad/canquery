require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { OAuth2Client } = require('google-auth-library');
const { READONLY_SCOPE, clientConfig, writePrivateJson } = require('../services/googleSearchConsoleAuth');

function arg(name) {
    const index = process.argv.indexOf(name);
    if (index !== -1) return process.argv[index + 1];
    const entry = process.argv.find(value => value.startsWith(name + '='));
    return entry ? entry.slice(name.length + 1) : null;
}

async function main() {
    const inputPath = arg('--client-secret');
    const outputPath = arg('--output') || process.env.GSC_OAUTH_PATH;
    if (!inputPath || !outputPath) {
        throw new Error('Usage: node scripts/authorize-search-console.js --client-secret FILE --output FILE');
    }
    const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const config = clientConfig(raw);
    const state = crypto.randomBytes(24).toString('hex');

    let resolveCallback;
    let rejectCallback;
    const callback = new Promise((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth2/callback') {
            res.writeHead(404).end('Not found');
            return;
        }
        if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Authorization was rejected or invalid.');
            rejectCallback(new Error('OAuth callback failed validation'));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('CanQuery Search Console authorization complete. You may close this window.');
        resolveCallback(url.searchParams.get('code'));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const redirectUri = 'http://127.0.0.1:' + address.port + '/oauth2/callback';
    const auth = new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
    const authUrl = auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [READONLY_SCOPE],
        state,
        include_granted_scopes: false
    });
    console.log('Open this URL in your browser and approve read-only Search Console access:\n' + authUrl);
    const timeout = setTimeout(() => rejectCallback(new Error('OAuth callback timed out after 10 minutes')), 10 * 60 * 1000);
    try {
        const code = await callback;
        const { tokens } = await auth.getToken(code);
        if (!tokens.refresh_token) throw new Error('Google did not return a refresh token; revoke the prior grant and try again');
        writePrivateJson(outputPath, {
            client: {
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: redirectUri
            },
            tokens,
            scope: READONLY_SCOPE
        });
        console.log('Saved the private OAuth credential file with mode 0600.');
    } finally {
        clearTimeout(timeout);
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(err => {
    console.error('Search Console authorization failed:', err.message);
    process.exit(1);
});
