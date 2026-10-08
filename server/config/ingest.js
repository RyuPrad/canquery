const { numberSetting, envNumber } = require('./numbers');

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

function ingestLimits(env = process.env) {
    return {
        maxFileBytes: envNumber('MAX_FILE_MB', 50, { min: 1 / MIB, max: Number.MAX_SAFE_INTEGER / MIB }, env) * MIB,
        maxXlsxBytes: envNumber('MAX_XLSX_MB', 20, { min: 1 / MIB, max: Number.MAX_SAFE_INTEGER / MIB }, env) * MIB,
        maxRows: envNumber('MAX_ROWS', 1_000_000, { min: 1, integer: true }, env),
        maxCols: envNumber('MAX_COLS', 120, { min: 1, integer: true }, env),
        stallTimeoutMs: envNumber('INGEST_STALL_TIMEOUT_MS', 60_000, { min: 1, max: 2 ** 31 - 1, integer: true }, env)
    };
}

function storageOptions(caps = {}, env = process.env) {
    const setting = (property, name, fallback, scale = 1, min = 0) => {
        if (caps[property] !== undefined && caps[property] !== null && String(caps[property]).trim() !== '') {
            return numberSetting(property, caps[property], undefined, { min });
        }
        return envNumber(name, fallback, { min: min / scale, max: Number.MAX_SAFE_INTEGER / scale }, env) * scale;
    };
    return {
        budgetBytes: setting('storeBudgetBytes', 'STORE_BUDGET_GB', 15, GIB, 1),
        reserveFloorBytes: setting('storeReserveBytes', 'STORE_INGEST_HEADROOM_MB', 256, MIB),
        reserveMultiplier: setting('storeSizeMultiplier', 'STORE_SIZE_RESERVE_MULTIPLIER', 2),
        minTmpFreeBytes: setting('minTmpFreeBytes', 'TMP_MIN_FREE_MB', 512, MIB),
        storeDataPath: caps.storeDataPath || env.STORE_DATA_PATH?.trim() || null,
        minStoreFreeBytes: setting('minStoreFreeBytes', 'STORE_MIN_FREE_GB', 2, GIB)
    };
}

module.exports = { ingestLimits, storageOptions };
