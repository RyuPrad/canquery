const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    storageConfig,
    objectKeyFor,
    cleanEtag,
    sha256File,
    headObject,
    getObjectRange,
    uploadArchive
} = require('../services/r2MapStorage');

const config = {
    endpoint: 'https://account.r2.cloudflarestorage.com',
    bucket: 'canquery-maps-prod',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    region: 'auto',
    budgetBytes: 1024
};

describe('private R2 PMTiles storage', () => {
    test('validates configuration and derives opaque immutable keys', () => {
        expect(storageConfig(config)).toEqual(expect.objectContaining({
            endpoint: 'https://account.r2.cloudflarestorage.com',
            bucket: 'canquery-maps-prod', budgetBytes: 1024
        }));
        const key = objectKeyFor('public-resource-id', 'a'.repeat(64));
        expect(key).toMatch(/^maps\/[0-9a-f]{64}\/a{64}\.pmtiles$/);
        expect(key).not.toContain('public-resource-id');
        expect(() => objectKeyFor('resource', 'latest')).toThrow(/version/);
        expect(cleanEtag('"etag"')).toBe('etag');
    });

    test('heads missing objects without hiding transient errors', async () => {
        const missing = { send: jest.fn().mockRejectedValue({
            name: 'NotFound', $metadata: { httpStatusCode: 404 }
        }) };
        await expect(headObject('maps/missing', { config, client: missing })).resolves.toBeNull();
        const failed = { send: jest.fn().mockRejectedValue(new Error('network down')) };
        await expect(headObject('maps/missing', { config, client: failed })).rejects.toThrow('network down');
    });

    test('uses bounded conditional byte ranges', async () => {
        const bytes = Uint8Array.from([1, 2, 3, 4]);
        const client = { send: jest.fn().mockResolvedValue({
            Body: { transformToByteArray: async () => bytes },
            ContentRange: 'bytes 10-13/100', ETag: '"immutable"'
        }) };
        const result = await getObjectRange('maps/archive', 10, 4, {
            config, client, etag: 'immutable'
        });
        expect(new Uint8Array(result.data)).toEqual(bytes);
        expect(client.send.mock.calls[0][0].input).toEqual(expect.objectContaining({
            Range: 'bytes=10-13', IfMatch: '"immutable"'
        }));
        await expect(getObjectRange('maps/archive', 0, 20 * 1024 * 1024, { config, client }))
            .rejects.toThrow(/range/);
    });

    test('uploads with integrity metadata and verifies the resulting head', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'r2-test-'));
        const file = path.join(dir, 'archive.pmtiles');
        await fs.promises.writeFile(file, 'archive-data');
        const sha = await sha256File(file);
        let uploadOptions;
        class FakeUpload {
            constructor(options) { uploadOptions = options; }
            async done() {}
            abort() {}
        }
        const client = { send: jest.fn().mockResolvedValue({
            ContentLength: 12, ETag: '"etag"', Metadata: { sha256: sha }
        }) };
        try {
            await expect(uploadArchive(file, 'maps/key', {
                resourceId: 'r1', version: 'b'.repeat(64)
            }, { config, client, UploadClass: FakeUpload })).resolves.toEqual(expect.objectContaining({
                byteSize: 12, etag: 'etag', sha256: sha
            }));
            expect(uploadOptions.params).toEqual(expect.objectContaining({
                Bucket: 'canquery-maps-prod', Key: 'maps/key',
                ContentType: 'application/vnd.pmtiles',
                CacheControl: 'public, max-age=31536000, immutable'
            }));
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });
});
