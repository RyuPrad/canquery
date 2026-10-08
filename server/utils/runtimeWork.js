// Account finalization and request handlers can outlive their HTTP sockets.
const pending = new Set();
function track(promise) {
    const work = Promise.resolve(promise);
    pending.add(work);
    work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
}
async function drain() {
    while (pending.size) await Promise.allSettled([...pending]);
}
module.exports = { track, drain };
