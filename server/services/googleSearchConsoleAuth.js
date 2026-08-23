const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function clientConfig(raw) {
    const config = raw?.client || raw?.installed || raw?.web;
    if (!config?.client_id || !config?.client_secret) {
        throw new Error('OAuth credential file is missing client_id or client_secret');
    }
    return {
        clientId: config.client_id,
        clientSecret: config.client_secret,
        redirectUri: config.redirect_uri || config.redirect_uris?.[0] || null
    };
}

function readCredentialFile(filePath) {
    if (!filePath) throw new Error('GSC_OAUTH_PATH is required');
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        throw new Error('Could not read OAuth credential file: ' + err.message, { cause: err });
    }
    return { raw, client: clientConfig(raw), tokens: raw.tokens || null };
}

function writePrivateJson(filePath, value) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'w' });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, filePath);
}

function createAuthorizedClient(filePath) {
    const credential = readCredentialFile(filePath);
    if (!credential.tokens?.refresh_token) {
        throw new Error('OAuth credential file has no refresh token; run authorize-search-console.js first');
    }
    const auth = new OAuth2Client(
        credential.client.clientId,
        credential.client.clientSecret,
        credential.client.redirectUri || undefined
    );
    auth.setCredentials(credential.tokens);
    auth.on('tokens', (tokens) => {
        const next = {
            client: {
                client_id: credential.client.clientId,
                client_secret: credential.client.clientSecret,
                redirect_uri: credential.client.redirectUri
            },
            tokens: { ...credential.tokens, ...tokens },
            scope: READONLY_SCOPE
        };
        credential.tokens = next.tokens;
        writePrivateJson(filePath, next);
    });
    return auth;
}

module.exports = {
    READONLY_SCOPE,
    clientConfig,
    readCredentialFile,
    writePrivateJson,
    createAuthorizedClient
};
