const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { numberSetting } = require('../config/numbers');
const { ingestLimits, storageOptions } = require('../config/ingest');

test('the checked-in example has the same ingestion defaults as absent settings', () => {
    const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.example')));
    expect(ingestLimits(env)).toEqual(ingestLimits({}));
    expect(storageOptions({}, env)).toEqual(storageOptions({}, {}));
});

test.each([undefined, null, '', ' \t '])('blank numeric setting %p uses its default', value => {
    expect(numberSetting('LIMIT', value, 12)).toBe(12);
});

test('storage blanks retain floors while explicit zero remains meaningful', () => {
    const keys = ['STORE_INGEST_HEADROOM_MB', 'STORE_SIZE_RESERVE_MULTIPLIER', 'TMP_MIN_FREE_MB', 'STORE_MIN_FREE_GB'];
    expect(storageOptions({}, Object.fromEntries(keys.map(key => [key, ' \t '])))).toEqual(storageOptions({}, {}));
    expect(storageOptions({}, Object.fromEntries(keys.map(key => [key, '0'])))).toMatchObject({
        reserveFloorBytes: 0, reserveMultiplier: 0, minTmpFreeBytes: 0, minStoreFreeBytes: 0
    });
    expect(storageOptions({}, { STORE_MIN_FREE_GB: '35', STORE_BUDGET_GB: '5' })).toMatchObject({
        minStoreFreeBytes: 35 * 1024 ** 3, budgetBytes: 5 * 1024 ** 3
    });
});

test.each(['NaN', 'Infinity', '-1', 'not-a-number', '1e100'])('invalid safety input %s fails with the setting name', value => {
    expect(() => storageOptions({}, { STORE_MIN_FREE_GB: value })).toThrow('STORE_MIN_FREE_GB');
});

test.each(['0', '-2', '1.5', 'Infinity'])('invalid row cap %s fails instead of falling back', value => {
    expect(() => ingestLimits({ MAX_ROWS: value })).toThrow('MAX_ROWS');
});

test('an explicit internal override does not evaluate the unused environment fallback', () => {
    expect(storageOptions({ minStoreFreeBytes: 123 }, { STORE_MIN_FREE_GB: 'invalid' }).minStoreFreeBytes).toBe(123);
    expect(() => storageOptions({ minStoreFreeBytes: -1 }, {})).toThrow('minStoreFreeBytes');
});
