const { startWarming } = require('../utils/warming');

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});
const settle = () => jest.advanceTimersByTimeAsync(0);

test('runs the steps in order at start and again each interval, one pass at a time, until stopped', async () => {
    const calls = [];
    let release;
    const slow = () => { calls.push('slow'); return new Promise(resolve => { release = resolve; }); };
    const quick = async () => { calls.push('quick'); };
    const stop = startWarming('test', [slow, quick], { intervalMs: 1000 });
    await settle();
    expect(calls).toEqual(['slow']);
    // A pass still running delays the passes that fall due meanwhile.
    await jest.advanceTimersByTimeAsync(3000);
    expect(calls).toEqual(['slow']);
    release();
    await settle();
    expect(calls).toEqual(['slow', 'quick']);
    await jest.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['slow', 'quick', 'slow']);
    release();
    await settle();
    stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual(['slow', 'quick', 'slow', 'quick']);
});

test('a failing step ends that pass with a generic warning, and the next pass still runs', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const after = jest.fn(async () => {});
    const stop = startWarming('test', [async () => { throw new Error('private detail'); }, after], { intervalMs: 1000 });
    try {
        await settle();
        expect(console.warn).toHaveBeenCalledWith('[test] warming failed');
        expect(after).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1000);
        expect(console.warn).toHaveBeenCalledTimes(2);
        expect(console.warn.mock.calls.flat().join(' ')).not.toContain('private detail');
    } finally {
        stop();
    }
});
