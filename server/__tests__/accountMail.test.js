jest.mock('../db/pool', () => ({}));
jest.mock('../db/commercialQueries', () => ({ transaction: jest.fn() }));

const { encrypt, decrypt } = require('../services/accountMail');

const originalSecret = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'fixture-only-mail-secret-with-at-least-thirty-two-characters';
});

afterAll(() => {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
});

test('account mail uses an authenticated 16-byte GCM tag', () => {
    const message = { to: 'fixture@example.test', subject: 'Fixture', text: 'Private fixture' };
    const encrypted = encrypt(message);
    const bytes = Buffer.from(encrypted,'base64');
    expect(bytes.length).toBeGreaterThan(28);
    expect(decrypt(encrypted)).toEqual(message);

    bytes[12] ^= 1;
    expect(() => decrypt(bytes.toString('base64'))).toThrow();
});
