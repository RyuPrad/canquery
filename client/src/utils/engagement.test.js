import { describe, expect, test, vi } from 'vitest';

// Engagement is page-wide state that never resets, so each test loads a fresh copy.
const load = async () => {
  vi.resetModules();
  return import('./engagement.js');
};
const input = (type, extra = {}) => ({ type, isTrusted: true, ...extra });
function fakeTarget() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener: vi.fn((type, handler, options) => handlers.set(type, { handler, options })),
    removeEventListener: vi.fn()
  };
}

describe('isPersonInput', () => {
  test.each(['pointerdown', 'touchstart', 'wheel', 'keydown', 'click'])('counts a %s from the browser', async (type) => {
    const { isPersonInput } = await load();
    expect(isPersonInput(input(type))).toBe(true);
  });

  test('counts a pointer whose position changes, not one that only reports where it rests', async () => {
    const { isPersonInput } = await load();
    // WebKit reports movementX and movementY as zero even for real movement.
    expect(isPersonInput(input('pointermove', { clientX: 40, clientY: 30, movementX: 0, movementY: 0 }))).toBe(false);
    expect(isPersonInput(input('pointermove', { clientX: 40, clientY: 30, movementX: 0, movementY: 0 }))).toBe(false);
    expect(isPersonInput(input('pointermove', { clientX: 40, clientY: 27, movementX: 0, movementY: 0 }))).toBe(true);
  });

  test('ignores events created by scripts and events code can cause', async () => {
    const { isPersonInput } = await load();
    expect(isPersonInput(input('keydown', { isTrusted: false }))).toBe(false);
    expect(isPersonInput(input('click', { isTrusted: false }))).toBe(false);
    expect(isPersonInput(input('scroll'))).toBe(false);
    expect(isPersonInput(input('focusin'))).toBe(false);
  });
});

describe('watchEngagement', () => {
  test('listens passively until the first person input, then notifies once and stops', async () => {
    const engagement = await load();
    const target = fakeTarget();
    const notify = vi.fn();
    engagement.subscribeEngagement(notify);
    engagement.watchEngagement(target);
    expect([...target.handlers.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel']);
    for (const { options } of target.handlers.values()) expect(options).toEqual({ capture: true, passive: true });

    target.handlers.get('keydown').handler(input('keydown', { isTrusted: false }));
    target.handlers.get('pointermove').handler(input('pointermove', { clientX: 5, clientY: 5 }));
    target.handlers.get('pointermove').handler(input('pointermove', { clientX: 5, clientY: 5 }));
    expect(engagement.isEngaged()).toBe(false);
    expect(notify).not.toHaveBeenCalled();

    target.handlers.get('pointermove').handler(input('pointermove', { clientX: 9, clientY: 6 }));
    expect(engagement.isEngaged()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener.mock.calls.map(([type]) => type).sort()).toEqual([...target.handlers.keys()].sort());

    engagement.markEngaged();
    target.handlers.get('click').handler(input('click'));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('the button can mark a person directly; a later watch adds no listeners and unsubscribing stops notices', async () => {
    const engagement = await load();
    const notify = vi.fn();
    const unsubscribe = engagement.subscribeEngagement(notify);
    unsubscribe();
    engagement.markEngaged();
    expect(engagement.isEngaged()).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    const target = fakeTarget();
    engagement.watchEngagement(target);
    expect(target.addEventListener).not.toHaveBeenCalled();
  });
});
