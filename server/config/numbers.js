// Parse operator settings explicitly: blank means default, never zero. Keep
// names (not raw environment contents) in errors and startup diagnostics.
function numberSetting(name, raw, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return fallback;
    const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
        throw new Error(name + ' must be ' + (integer ? 'an integer' : 'a finite number') + ' between ' + min + ' and ' + max);
    }
    return value;
}

function envNumber(name, fallback, options = {}, env = process.env) {
    return numberSetting(name, env[name], fallback, options);
}

module.exports = { numberSetting, envNumber };
