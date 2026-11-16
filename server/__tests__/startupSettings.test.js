// app.js checks its settings as it loads: a malformed one stops the API there,
// before it can serve a page with it. A page reads INDEX_POLICY_ENGINES again
// on every request, so without that check a mistyped value would answer 503 on
// every dataset and file page while /healthz stayed green. (Each setting's own
// rule is tested with its module.)
const SETTINGS = ['ADSENSE_CLIENT', 'INDEXNOW_KEY', 'INDEX_POLICY_SINCE', 'INDEX_POLICY_ENGINES'];

function loadApp(env = {}) {
    const saved = Object.fromEntries(SETTINGS.map(name => [name, process.env[name]]));
    // An empty value is "not set" to every rule, and keeps server/.env (which
    // app.js reads as it loads) from filling the setting in.
    for (const name of SETTINGS) process.env[name] = env[name] ?? '';
    let error = null;
    try {
        jest.isolateModules(() => {
            try { require('../app'); } catch (err) { error = err; }
        });
    } finally {
        for (const name of SETTINGS) {
            if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
        }
    }
    return error;
}

describe('settings the API refuses to start with', () => {
    test('it starts with none of them set, and with each one set properly', () => {
        expect(loadApp()).toBeNull();
        expect(loadApp({ INDEXNOW_KEY: '0123456789abcdef0123456789abcdef', INDEX_POLICY_SINCE: '2026-11-16T07:59:59Z',
            INDEX_POLICY_ENGINES: 'google' })).toBeNull();
        expect(loadApp({ INDEX_POLICY_ENGINES: ' all ' })).toBeNull();
    });

    test.each([
        ['INDEX_POLICY_ENGINES', 'bing', 'INDEX_POLICY_ENGINES must be all or google'],
        ['INDEX_POLICY_ENGINES', 'Google', 'INDEX_POLICY_ENGINES must be all or google'],
        ['INDEX_POLICY_SINCE', 'yesterday', 'INDEX_POLICY_SINCE must be a UTC time'],
        ['INDEXNOW_KEY', 'short', 'INDEXNOW_KEY must be 8 to 128 letters, digits or hyphens'],
        ['ADSENSE_CLIENT', 'pub-123', 'ADSENSE_CLIENT must be "ca-pub-" followed by 16 digits']
    ])('%s=%s stops it', (name, value, message) => {
        const error = loadApp({ [name]: value });
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain(message);
    });
});
