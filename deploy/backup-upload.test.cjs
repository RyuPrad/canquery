const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configuration, validateManifest, validReceipt, expiredSets, verifyObject, prune } = require('./backup-upload.cjs');

const recipient = 'age1' + 'q'.repeat(58);
const env = { CANQUERY_BACKUP_R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
    CANQUERY_BACKUP_R2_BUCKET: 'canquery-backups-test', CANQUERY_BACKUP_AGE_RECIPIENT: recipient,
    CANQUERY_BACKUP_R2_ACCESS_KEY_ID: 'test', CANQUERY_BACKUP_R2_SECRET_ACCESS_KEY: 'test' };
test('backup configuration requires HTTPS, explicit credentials and public age recipient', () => {
    assert.equal(configuration(env).recipient, recipient);
    for (const value of ['', 'http://example.com', 'https://user:secret@example.com']) {
        assert.throws(() => configuration({ ...env, CANQUERY_BACKUP_R2_ENDPOINT: value }));
    }
    assert.throws(() => configuration({ ...env, CANQUERY_BACKUP_R2_ACCESS_KEY_ID: '' }));
    assert.throws(() => configuration({ ...env, CANQUERY_BACKUP_AGE_RECIPIENT: 'private-key' }));
});
const manifest = { version: 1, stamp: '20261008T013001Z', release: 'a'.repeat(40), files: [
    { name: 'app.dump', path: '/private/app.dump', kind: 'database' },
    { name: 'analytics.dump', path: '/private/analytics.dump', kind: 'database' },
    { name: 'configuration.tar', path: '/private/configuration.tar', kind: 'configuration' }
] };
test('complete recovery manifests require both databases and a configuration archive', () => {
    assert.equal(validateManifest(manifest), manifest);
    assert.throws(() => validateManifest({ ...manifest, files: manifest.files.slice(0, 2) }));
    assert.throws(() => validateManifest({ ...manifest, stamp: '../bad' }));
    assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, manifest.files[0]] }));
});
const receipt = day => ({ ...manifest, stamp: `202610${day}T013001Z`, verified_at: `2026-10-${day}T01:35:00Z`,
    files: manifest.files.map(file => ({ name: file.name, kind: file.kind,
        key: `daily/202610${day}T013001Z/${file.name}.age`, bytes: 3,
        plaintext_sha256: 'a'.repeat(64), ciphertext_sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })) });
test('retention preserves the newest two recovery points even after a prolonged outage', () => {
    const now = Date.parse('2026-12-08T00:00:00Z');
    assert.deepEqual(expiredSets([receipt('01'), receipt('02')], now), []);
    assert.deepEqual(expiredSets([receipt('01'), receipt('02'), receipt('03')], now).map(r => r.stamp), ['20261001T013001Z']);
    assert.deepEqual(expiredSets([{ ...receipt('01'), files: [] }], now), []);
});
test('retention rejects unrelated keys, duplicate names, incomplete receipts and future dates', () => {
    const base = receipt('01');
    assert.equal(validReceipt(base, Date.parse('2026-12-08')), true);
    assert.equal(validReceipt({ ...base, files: [...base.files.slice(0, 2), base.files[0]] }), false);
    assert.equal(validReceipt({ ...base, files: base.files.map(file => ({ ...file, key: 'maps/important' })) }), false);
    assert.equal(validReceipt({ ...base, verified_at: '2100-01-01T00:00:00Z' }), false);
});
test('missing newest recovery objects stop pruning before any deletion', async () => {
    const records = [receipt('01'), receipt('02'), receipt('03')];
    let deletions = 0;
    const client = { send: async command => {
        if (command.constructor.name === 'ListObjectsV2Command') return { Contents: records.map(r => ({ Key: `daily/${r.stamp}/complete.json` })) };
        if (command.constructor.name === 'DeleteObjectCommand') { deletions++; return {}; }
        const found = records.find(r => command.input.Key === `daily/${r.stamp}/complete.json`);
        if (found) return { Body: { transformToString: async () => JSON.stringify(found) } };
        throw new Error('missing remote object');
    } };
    await assert.rejects(prune(client, { bucket: 'test' }), /missing remote object/);
    assert.equal(deletions, 0);
});
test('remote verification hashes the downloaded bytes rather than relying on ETag', async () => {
    const client = { send: async () => ({ Body: (async function* () { yield Buffer.from('a'); yield Buffer.from('bc'); })() }) };
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    assert.equal((await verifyObject(client, 'bucket', 'key', expected, 3)).ciphertext_sha256, expected);
    await assert.rejects(verifyObject(client, 'bucket', 'key', '0'.repeat(64), 3));
    await assert.rejects(verifyObject(client, 'bucket', 'key', expected, 4));
});
