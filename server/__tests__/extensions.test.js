const path = require('path');

const ENTRY = path.join(__dirname, '..', 'enterprise', 'index.js');

function loadWithoutExtension() {
    let loaded;
    jest.isolateModules(() => {
        const fs = require('fs');
        const exists = fs.existsSync.bind(fs);
        jest.spyOn(fs, 'existsSync').mockImplementation(target => target !== ENTRY && exists(target));
        loaded = require('../extensions');
    });
    return loaded;
}

afterEach(() => jest.restoreAllMocks());

describe('extension hooks without an installed extension', () => {
    test('every hook is inert in the community edition', async () => {
        const { extension } = loadWithoutExtension();
        const hooks = extension();
        expect(hooks.edition).toBe('community');
        const app = { use: jest.fn(), post: jest.fn(), all: jest.fn() };
        hooks.mountBeforeBodyParsing(app);
        hooks.mountAfterBodyParsing(app);
        expect(app.use).not.toHaveBeenCalled();
        expect(hooks.apiMiddleware()).toEqual([]);
        await expect(hooks.start()).resolves.toEqual({});
        await expect(hooks.preparation.charge({}, { accountId: 'a' }, 1)).resolves.toBeUndefined();
        await expect(hooks.preparation.settle({}, 1)).resolves.toBeUndefined();
        expect(hooks.pages()).toEqual({ routes: [], overrides: {} });
        expect(hooks.health()).toEqual({ components: [], metrics: [] });
    });

    test('refuses a community build against a hosted database', async () => {
        const { assertEditionMatchesDatabase } = loadWithoutExtension();
        const hosted = { query: jest.fn(async () => ({ rows: [{ hosted: true }] })) };
        await expect(assertEditionMatchesDatabase(hosted)).rejects.toThrow(/hosted edition/);
        const community = { query: jest.fn(async () => ({ rows: [{ hosted: false }] })) };
        await expect(assertEditionMatchesDatabase(community)).resolves.toBeUndefined();
    });
});

test('the installed hosted extension skips the database edition check', async () => {
    const { extension, assertEditionMatchesDatabase } = require('../extensions');
    expect(extension().edition).toBe('enterprise');
    const db = { query: jest.fn() };
    await assertEditionMatchesDatabase(db);
    expect(db.query).not.toHaveBeenCalled();
});
