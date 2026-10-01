const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const {
    downloadToTempFile,
    isPublicAddress,
    openValidatedResponse,
    resolvePublicTarget,
    validateDownloadUrl
} = require('../services/csvDownload');

function mockRequest(responses, inspectOptions) {
    const calls = [];
    const request = jest.fn((url, options, callback) => {
        calls.push(url.href);
        if (inspectOptions) inspectOptions(options);
        const req = new EventEmitter();
        req.end = () => {
            const next = responses.shift();
            queueMicrotask(() => callback({
                statusCode: next.status,
                headers: next.headers || {},
                destroy: jest.fn()
            }));
        };
        return req;
    });
    return { request, calls };
}

describe('secure catalogue downloads', () => {
    test.each([
        'file:///etc/passwd',
        'ftp://example.com/file.csv',
        'https://user:secret@example.com/file.csv',
        'https://example.com:8443/file.csv'
    ])('rejects unsafe URL %s', (url) => {
        expect(() => validateDownloadUrl(url)).toThrow(/download URL/i);
    });

    test.each([
        '0.0.0.1',
        '10.1.2.3',
        '100.64.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '172.31.0.1',
        '192.168.1.1',
        '198.18.0.1',
        '224.0.0.1',
        '255.255.255.255',
        '::',
        '::1',
        '::2',
        '::ffff:127.0.0.1',
        'fc00::1',
        'fe80::1',
        'fec0::1',
        'ff02::1'
    ])('classifies %s as non-public', (address) => {
        expect(isPublicAddress(address)).toBe(false);
    });

    test.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
        'classifies %s as public',
        (address) => expect(isPublicAddress(address)).toBe(true)
    );

    it('rejects a hostname if any DNS answer is non-public', async () => {
        const lookup = jest.fn(async () => [
            { address: '8.8.8.8', family: 4 },
            { address: '127.0.0.1', family: 4 }
        ]);
        await expect(resolvePublicTarget('rebind.example', lookup)).rejects.toMatchObject({
            code: 'DOWNLOAD_URL_BLOCKED'
        });
    });

    it('prefers a validated IPv4 answer when both address families are public', async () => {
        const lookup = jest.fn(async () => [
            { address: '2606:4700:4700::1111', family: 6 },
            { address: '1.1.1.1', family: 4 }
        ]);
        await expect(resolvePublicTarget('dual-stack.example', lookup)).resolves.toEqual({
            address: '1.1.1.1',
            family: 4
        });
    });

    it('pins the connection lookup to the address that was validated', async () => {
        const lookup = jest.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
        const seen = [];
        const { request } = mockRequest([{ status: 200 }], (options) => {
            options.lookup('download.example', {}, (err, address, family) => {
                seen.push({ err, address, family });
            });
        });
        const { response } = await openValidatedResponse('https://download.example/data.csv', {
            lookupImpl: lookup,
            requestImpl: request
        });
        expect(response.statusCode).toBe(200);
        expect(seen).toEqual([{ err: null, address: '8.8.8.8', family: 4 }]);
    });

    it('revalidates a redirect and blocks a hop to loopback', async () => {
        const lookup = jest.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
        const { request, calls } = mockRequest([{
            status: 302,
            headers: { location: 'http://127.0.0.1/internal.csv' }
        }]);
        await expect(openValidatedResponse('https://download.example/data.csv', {
            lookupImpl: lookup,
            requestImpl: request
        })).rejects.toMatchObject({ code: 'DOWNLOAD_URL_BLOCKED' });
        expect(calls).toHaveLength(1);
    });

    it('applies the download stall timeout while DNS resolution is pending', async () => {
        const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('canquery-ingest-')));
        const started = Date.now();
        await expect(downloadToTempFile('https://dns-stall.example/data.csv', {
            maxFileBytes: 1024,
            stallTimeoutMs: 50,
            lookupImpl: () => new Promise(() => {})
        })).rejects.toThrow(/stall/i);
        expect(Date.now() - started).toBeLessThan(2000);
        const leftovers = fs.readdirSync(os.tmpdir())
            .filter(name => name.startsWith('canquery-ingest-') && !before.has(name));
        expect(leftovers).toHaveLength(0);
    });

    test.each(['ENOTFOUND', 'ENODATA'])('types transport DNS failure %s and retains its private cause', async code => {
        const cause = Object.assign(new Error('hostname details'), { code });
        await expect(downloadToTempFile('https://download.example/data.csv', {
            maxFileBytes: 1024,
            lookupImpl: () => Promise.reject(cause)
        })).rejects.toMatchObject({ code: 'DOWNLOAD_DNS', cause, message: expect.stringContaining(cause.message) });
    });

    test.each([
        'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_REVOKED',
        'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'ERR_TLS_CERT_ALTNAME_INVALID'
    ])('types transport certificate failure %s without bypassing validation', async code => {
        const cause = Object.assign(new Error('certificate details'), { code });
        const requestImpl = jest.fn((_url, options) => {
            expect(options).not.toHaveProperty('rejectUnauthorized');
            expect(options.servername).toBe('download.example');
            const request = new EventEmitter();
            request.end = () => queueMicrotask(() => request.emit('error', cause));
            return request;
        });
        await expect(downloadToTempFile('https://download.example/data.csv', {
            maxFileBytes: 1024,
            lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
            requestImpl
        })).rejects.toMatchObject({ code: 'DOWNLOAD_CERTIFICATE', cause, message: expect.stringContaining(cause.message) });
    });

    test('types a native fetch transport cause at the download boundary', async () => {
        const cause = new TypeError('fetch failed', {
            cause: Object.assign(new Error('hostname details'), { code: 'ENOTFOUND' })
        });
        await expect(downloadToTempFile('https://download.example/data.csv', {
            maxFileBytes: 1024,
            fetchImpl: () => Promise.reject(cause)
        })).rejects.toMatchObject({ code: 'DOWNLOAD_DNS', cause, message: expect.stringContaining('hostname details') });
    });

    test.each(['EAI_AGAIN', 'ECONNRESET', 'ERR_SSL_WRONG_VERSION_NUMBER', '08P01', '53100'])('preserves other transport failure %s', async code => {
        const cause = Object.assign(new Error('temporary failure'), { code });
        await expect(downloadToTempFile('https://download.example/data.csv', {
            maxFileBytes: 1024,
            fetchImpl: () => Promise.reject(cause)
        })).rejects.toBe(cause);
    });
});
