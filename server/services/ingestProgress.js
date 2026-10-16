// Progress of one preparation, as the page waiting for it shows it: the bytes
// downloaded so far against the file's length, then the rows loaded, then the
// finishing steps (type conversion, index, publication). Writes are throttled
// so a fast download does not turn every chunk into a database update; a
// phase change and the first report always go through.
const PHASES = ['downloading', 'loading', 'finishing'];

function createProgressReporter(write, { minIntervalMs = 1000, now = Date.now } = {}) {
    let last = null;
    let lastWriteAt = -Infinity;
    let pending = null;
    let writing = false;
    const flushPending = async () => {
        if (writing || !pending) return;
        const next = pending;
        pending = null;
        writing = true;
        try {
            await write(next);
        } catch {
            // Progress is advisory: a failed write never fails the preparation.
        } finally {
            writing = false;
            if (pending) await flushPending();
        }
    };
    return {
        report(progress) {
            if (!progress || !PHASES.includes(progress.phase)) return false;
            const stamp = now();
            const phaseChanged = !last || last.phase !== progress.phase;
            const snapshot = { ...last, ...progress, updated_at: new Date(stamp).toISOString() };
            last = snapshot;
            if (!phaseChanged && stamp - lastWriteAt < minIntervalMs) return false;
            lastWriteAt = stamp;
            pending = snapshot;
            void flushPending();
            return true;
        },
        last: () => last
    };
}

module.exports = { createProgressReporter, PHASES };
