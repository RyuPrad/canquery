const { track } = require('./runtimeWork');

// Runs the steps in order as soon as it starts, then again every intervalMs.
// One pass at a time: a pass still running when the next is due delays it.
// Shutdown waits for tracked work, so pools stay open for a running pass.
// Returns a function that stops future passes.
function startWarming(name, steps, { intervalMs }) {
    let stopped = false;
    let running = null;
    const run = () => {
        if (running || stopped) return;
        running = track((async () => {
            for (const step of steps) {
                if (stopped) return;
                await step();
            }
        })()).catch(() => console.warn('[' + name + '] warming failed')).finally(() => { running = null; });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

module.exports = { startWarming };
