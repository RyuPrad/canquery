import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createScrollMemory, entryKey, RESTORE_LIMIT_MS, restoreScroll, scrollAction, SETTLE_LIMIT_MS, SETTLE_MS
} from './scrollMemory.js';

const at = (pathname, search = '') => ({ pathname, search });

describe('scrollAction', () => {
  test('a link to another page starts at the top', () => {
    expect(scrollAction({ type: 'PUSH', previous: at('/datasets/a'), next: at('/resources/r1'), saved: false })).toBe('top');
    expect(scrollAction({ type: 'PUSH', previous: at('/'), next: at('/datasets/a', '?page=2'), saved: false })).toBe('top');
  });

  test('a catalogue page link starts at the top; another address of the same page keeps the window', () => {
    expect(scrollAction({ type: 'PUSH', previous: at('/datasets/a'), next: at('/datasets/a', '?page=2'), saved: false })).toBe('top');
    expect(scrollAction({ type: 'PUSH', previous: at('/datasets/a', '?page=3'), next: at('/datasets/a', '?page=2'), saved: false })).toBe('top');
    expect(scrollAction({ type: 'PUSH', previous: at('/'), next: at('/', '?keyword=water'), saved: false })).toBe('stay');
  });

  test('an address a page writes over its own entry keeps the window: a table page, a sort, a filter', () => {
    const resource = at('/resources/r1');
    expect(scrollAction({ type: 'REPLACE', previous: resource, next: at('/resources/r1', '?page=1'), saved: false })).toBe('stay');
    expect(scrollAction({ type: 'REPLACE', previous: at('/resources/r1', '?page=6'), next: at('/resources/r1', '?sort=year+asc'), saved: false })).toBe('stay');
    expect(scrollAction({ type: 'REPLACE', previous: at('/datasets', '?page=3'), next: at('/datasets', '?format=CSV'), saved: false })).toBe('stay');
    // A replacement that changes the page itself (a redirect) still starts at the top.
    expect(scrollAction({ type: 'REPLACE', previous: at('/places/old'), next: at('/places/new'), saved: false })).toBe('top');
  });

  test('Back and Forward return to the saved position, or act like a link without one', () => {
    expect(scrollAction({ type: 'POP', previous: at('/resources/r1'), next: at('/datasets/a'), saved: true })).toBe('restore');
    expect(scrollAction({ type: 'POP', previous: at('/datasets/a', '?page=2'), next: at('/datasets/a'), saved: true })).toBe('restore');
    expect(scrollAction({ type: 'POP', previous: at('/resources/r1'), next: at('/datasets/a'), saved: false })).toBe('top');
    expect(scrollAction({ type: 'POP', previous: at('/datasets/a', '?page=2'), next: at('/datasets/a'), saved: false })).toBe('top');
    expect(scrollAction({ type: 'POP', previous: at('/', '?q=water'), next: at('/'), saved: false })).toBe('stay');
  });

  test('a hash or history-state change leaves the window to the browser and the page', () => {
    for (const type of ['POP', 'PUSH', 'REPLACE']) {
      expect(scrollAction({ type, previous: at('/docs'), next: at('/docs'), saved: true })).toBe('stay');
    }
  });

  test('the first render returns only after a reload or a Back/Forward load with a saved position', () => {
    expect(scrollAction({ type: 'POP', previous: null, next: at('/datasets/a'), saved: true, documentRestored: true })).toBe('restore');
    expect(scrollAction({ type: 'POP', previous: null, next: at('/datasets/a'), saved: true, documentRestored: false })).toBe('top');
    expect(scrollAction({ type: 'POP', previous: null, next: at('/datasets/a'), saved: false, documentRestored: true })).toBe('top');
  });
});

describe('entryKey', () => {
  test('router entries use their key; a first entry, which shares the default key, uses its address', () => {
    expect(entryKey({ key: 'k7', pathname: '/datasets/a', search: '', hash: '' })).toBe('k7');
    expect(entryKey({ key: 'default', pathname: '/datasets/a', search: '?page=2', hash: '#files' })).toBe('default:/datasets/a?page=2#files');
  });
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (key) => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = value; } };
}

describe('createScrollMemory', () => {
  test('keeps one position per entry and only returns it for the same address', () => {
    const memory = createScrollMemory(null);
    memory.set('k1', '/datasets/a', 1234.6);
    expect(memory.get('k1', '/datasets/a')).toBe(1235);
    expect(memory.get('k1', '/datasets/b')).toBeNull();
    memory.set('k1', '/datasets/a', -20);
    expect(memory.get('k1', '/datasets/a')).toBe(0);
    memory.forget('k1');
    expect(memory.get('k1', '/datasets/a')).toBeNull();
  });

  test('keeps the latest 100 entries', () => {
    const memory = createScrollMemory(null);
    for (let i = 0; i < 105; i += 1) memory.set('k' + i, '/p', i);
    expect(memory.get('k4', '/p')).toBeNull();
    expect(memory.get('k5', '/p')).toBe(5);
    // Updating an entry makes it the latest.
    memory.set('k5', '/p', 50);
    for (let i = 105; i < 204; i += 1) memory.set('k' + i, '/p', i);
    expect(memory.get('k5', '/p')).toBe(50);
    expect(memory.get('k6', '/p')).toBeNull();
  });

  test('saves to session storage and reads it back in the next document', () => {
    const storage = fakeStorage();
    const memory = createScrollMemory(storage);
    memory.set('default:/datasets/a', '/datasets/a', 4498);
    memory.set('k2', '/resources/r1?page=1', 976);
    memory.save();
    const next = createScrollMemory(storage);
    expect(next.get('default:/datasets/a', '/datasets/a')).toBe(4498);
    expect(next.get('k2', '/resources/r1?page=1')).toBe(976);
  });

  test('unreadable, malformed or blocked storage starts empty and never throws', () => {
    expect(createScrollMemory(fakeStorage({ 'cq-scroll': '{not json' })).get('k', '/')).toBeNull();
    const odd = createScrollMemory(fakeStorage({ 'cq-scroll': JSON.stringify([['k', 'high', '/'], ['j', -5, '/'], 'x', ['ok', 10, '/']]) }));
    expect(odd.get('k', '/')).toBeNull();
    expect(odd.get('j', '/')).toBeNull();
    expect(odd.get('ok', '/')).toBe(10);
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const memory = createScrollMemory(blocked);
    memory.set('k', '/', 5);
    expect(() => memory.save()).not.toThrow();
    expect(memory.get('k', '/')).toBe(5);
  });
});

describe('restoreScroll', () => {
  let height;
  let y;
  let frames;
  let clock;
  const timing = () => ({
    now: () => clock,
    frame: (step) => { frames.push(step); return frames.length; },
    cancelFrame: vi.fn()
  });
  const nextFrame = (ms = 16) => {
    clock += ms;
    const step = frames.shift();
    step?.();
  };
  // Runs frames for `ms` of quiet page time.
  const runFor = (ms) => {
    const until = clock + ms;
    while (frames.length && clock < until) nextFrame();
  };

  beforeEach(() => {
    height = 1000;
    y = 0;
    frames = [];
    clock = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    window.scrollTo = vi.fn((x, top) => { y = top; });
  });
  afterEach(() => {
    delete document.documentElement.scrollHeight;
    delete window.scrollY;
  });

  test('scrolls at once when the page is already tall enough, then finishes once it has settled', () => {
    height = 6000;
    const done = vi.fn();
    restoreScroll(4498, done, timing());
    expect(window.scrollTo).toHaveBeenCalledWith(0, 4498);
    expect(done).not.toHaveBeenCalled();
    runFor(SETTLE_MS - 50);
    expect(done).not.toHaveBeenCalled();
    runFor(100);
    expect(done).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  test('waits for a page that is still loading to grow, then scrolls', () => {
    const done = vi.fn();
    restoreScroll(4498, done, timing());
    expect(window.scrollTo).not.toHaveBeenCalled();
    nextFrame();
    nextFrame();
    height = 5299; // room 4499
    nextFrame();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 4498);
    runFor(SETTLE_MS + 50);
    expect(done).toHaveBeenCalledTimes(1);
    expect(y).toBe(4498);
  });

  test('holds the position while a box that loads late above it pushes the content down', () => {
    height = 8323;
    const done = vi.fn();
    restoreScroll(7108, done, timing());
    expect(y).toBe(7108);
    runFor(200);
    // A 163 px box appears above; the browser's scroll anchoring moves the window with the content.
    height = 8486;
    y = 7271;
    nextFrame();
    expect(y).toBe(7108);
    // Its height change restarts the quiet period.
    runFor(SETTLE_MS - 50);
    expect(done).not.toHaveBeenCalled();
    runFor(100);
    expect(done).toHaveBeenCalledTimes(1);
    expect(y).toBe(7108);
  });

  test('while it holds, a scroll without a change of the page is left alone (a scroll-bar drag)', () => {
    height = 6000;
    const done = vi.fn();
    restoreScroll(4498, done, timing());
    runFor(100);
    y = 3900;
    runFor(200);
    expect(y).toBe(3900);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    runFor(SETTLE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test('a page that keeps changing is held for at most the settle limit', () => {
    height = 6000;
    const done = vi.fn();
    restoreScroll(4498, done, timing());
    while (frames.length && clock < SETTLE_LIMIT_MS + 200) {
      height += 1;
      nextFrame();
    }
    expect(done).toHaveBeenCalledTimes(1);
    expect(clock).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
    expect(clock).toBeLessThan(SETTLE_LIMIT_MS + 50);
  });

  test('a page that comes back shorter ends as close as it allows', () => {
    const done = vi.fn();
    restoreScroll(4498, done, timing());
    height = 3000;
    nextFrame(RESTORE_LIMIT_MS - 100);
    expect(done).not.toHaveBeenCalled();
    nextFrame(200);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 2200);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test('a visitor who scrolls, taps or types while it waits or holds keeps the position they chose', () => {
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
      window.scrollTo.mockClear();
      const done = vi.fn();
      restoreScroll(4498, done, timing());
      window.dispatchEvent(new Event(type));
      expect(done).toHaveBeenCalledTimes(1);
      height = 9000;
      nextFrame();
      expect(window.scrollTo).not.toHaveBeenCalled();
      height = 1000;
      frames = [];
    }
    // While holding: the visitor scrolls away and the page then changes height.
    height = 6000;
    const done = vi.fn();
    restoreScroll(4498, done, timing());
    runFor(100);
    window.dispatchEvent(new Event('wheel'));
    expect(done).toHaveBeenCalledTimes(1);
    y = 3000;
    height = 6200;
    nextFrame();
    expect(y).toBe(3000);
  });

  test('cancelling stops it without calling done', () => {
    const done = vi.fn();
    const cancel = restoreScroll(4498, done, timing());
    cancel();
    height = 9000;
    nextFrame();
    window.dispatchEvent(new Event('wheel'));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});
