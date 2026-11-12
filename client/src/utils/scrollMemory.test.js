import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createScrollMemory, entryKey, followHash, itemOnScreen, layoutTop, RESTORE_LIMIT_MS, restoreScroll, scrollAction, SETTLE_LIMIT_MS, SETTLE_MS
} from './scrollMemory.js';

const at = (pathname, search = '', hash = '') => ({ pathname, search, hash });

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
    expect(scrollAction({ type: 'POP', previous: null, next: at('/datasets/a'), saved: false, documentRestored: true })).toBe('top');
  });

  test("a fresh visit keeps the browser's place: the top, or the passage a text fragment names", () => {
    // A text fragment (#:~:text=, used by Google's "Read more" links and AI
    // Overview citations) never reaches location.hash.
    expect(scrollAction({ type: 'POP', previous: null, next: at('/datasets/a'), saved: true, documentRestored: false })).toBe('stay');
    expect(scrollAction({ type: 'POP', previous: null, next: at('/blog/calgary-ward-map'), saved: false })).toBe('stay');
    expect(scrollAction({ type: 'POP', previous: null, next: at('/docs', '', '#'), saved: false })).toBe('stay');
    expect(scrollAction({ type: 'POP', previous: null, next: at('/docs', '', '#%E0%A4%A'), saved: false })).toBe('stay');
  });

  test("a fresh visit to a fragment goes to its element; a reload still returns to the saved place", () => {
    expect(scrollAction({ type: 'POP', previous: null, next: at('/docs', '', '#preparation-example'), saved: false })).toBe('target');
    expect(scrollAction({ type: 'POP', previous: null, next: at('/docs', '', '#preparation-example'), saved: true, documentRestored: true })).toBe('restore');
  });

  test("a link to another page's fragment goes to its element; Back still returns to the saved place", () => {
    expect(scrollAction({ type: 'PUSH', previous: at('/blog/toronto-building-permits'), next: at('/docs', '', '#preparation-example'), saved: false })).toBe('target');
    expect(scrollAction({ type: 'PUSH', previous: at('/datasets/a'), next: at('/datasets/a', '?page=2', '#resources'), saved: false })).toBe('target');
    expect(scrollAction({ type: 'POP', previous: at('/resources/r1'), next: at('/docs', '', '#preparation-example'), saved: false })).toBe('target');
    expect(scrollAction({ type: 'POP', previous: at('/resources/r1'), next: at('/docs', '', '#preparation-example'), saved: true })).toBe('restore');
    expect(scrollAction({ type: 'REPLACE', previous: at('/resources/r1'), next: at('/resources/r1', '?page=2', '#table'), saved: false })).toBe('stay');
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

describe('followHash', () => {
  let height;
  let y;
  let frames;
  let clock;
  let element;
  let top;
  const timing = () => ({
    now: () => clock,
    frame: (step) => { frames.push(step); return frames.length; },
    cancelFrame: vi.fn()
  });
  const runFor = (ms) => {
    const until = clock + ms;
    while (frames.length && clock < until) {
      clock += 16;
      frames.shift()?.();
    }
  };
  // The element sits `top` pixels down the page and has a 96px scroll margin,
  // like the documentation's sections under the sticky navigation.
  const draw = () => {
    element = document.createElement('section');
    element.id = 'preparation-example';
    element.getBoundingClientRect = () => ({ top: top - y, bottom: top - y + 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: top - y });
    document.body.append(element);
  };

  beforeEach(() => {
    height = 12642;
    y = 0;
    top = 3194;
    frames = [];
    clock = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    window.scrollTo = vi.fn((x, to) => { y = to; });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => ({
      scrollMarginTop: node === element ? '96px' : '0px',
      scrollPaddingTop: 'auto'
    }));
  });
  afterEach(() => {
    element?.remove();
    element = null;
    vi.restoreAllMocks();
    delete document.documentElement.scrollHeight;
    delete window.scrollY;
  });

  test('goes to the element once the page draws it, above its scroll margin, and holds it while the page settles', () => {
    const done = vi.fn();
    followHash('#preparation-example', done, timing());
    runFor(400);
    expect(window.scrollTo).not.toHaveBeenCalled();
    draw();
    runFor(16);
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 3098);
    // The endpoint reference loads above it and pushes it down.
    top = 3394;
    height = 12842;
    runFor(16);
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 3298);
    runFor(SETTLE_MS + 50);
    expect(done).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  test('an element near the end goes as far as the page allows, then follows the page as it grows', () => {
    height = 4000;
    top = 3900;
    draw();
    const done = vi.fn();
    followHash('#preparation-example', done, timing());
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 3200);
    height = 5000;
    runFor(16);
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 3804);
  });

  test('a fragment whose element never comes keeps the window where it is', () => {
    y = 640;
    const done = vi.fn();
    followHash('#missing', done, timing());
    runFor(RESTORE_LIMIT_MS + 50);
    expect(done).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(y).toBe(640);
  });

  test('a visitor who scrolls or types while it waits keeps the position they chose', () => {
    const done = vi.fn();
    followHash('#preparation-example', done, timing());
    window.dispatchEvent(new Event('keydown'));
    expect(done).toHaveBeenCalledTimes(1);
    draw();
    runFor(100);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe('itemOnScreen', () => {
  // Items 40 px tall, the first one `first` px from the top of the window.
  const list = (count, first) => Array.from({ length: count }, (_, index) => ({
    getBoundingClientRect: vi.fn(() => ({ top: first + index * 40, bottom: first + index * 40 + 40 }))
  }));
  const win = (scrollY) => ({ scrollY, innerHeight: 800 });

  test('names the last item that starts at or above the middle of the window', () => {
    // Item 70 starts at 320, item 72 at exactly 400 (the middle), item 73 at 440.
    expect(itemOnScreen(list(1000, 320 - 70 * 40), win(2800))).toEqual({ index: 72, top: 400 });
    expect(itemOnScreen(list(1000, 321 - 70 * 40), win(2800))).toEqual({ index: 71, top: 361 });
  });

  test('reads a handful of items, not the whole list', () => {
    const items = list(4000, -80000);
    itemOnScreen(items, win(90000));
    expect(items.filter((item) => item.getBoundingClientRect.mock.calls.length > 0).length).toBeLessThan(16);
  });

  test('names the first item when the list starts below the middle, on screen', () => {
    expect(itemOnScreen(list(10, 600), win(300))).toEqual({ index: 0, top: 600 });
  });

  test('names the last item when the list ends above the middle, on screen', () => {
    expect(itemOnScreen(list(10, -300), win(5000))).toEqual({ index: 9, top: 60 });
  });

  test('is null at the top of the page, for an empty list and when no item is on screen', () => {
    expect(itemOnScreen(list(1000, 100), win(0))).toBeNull();
    expect(itemOnScreen([], win(500))).toBeNull();
    expect(itemOnScreen(list(10, 900), win(500))).toBeNull();
    expect(itemOnScreen(list(10, -2000), win(5000))).toBeNull();
  });
});

describe('layoutTop', () => {
  test('adds the offsets up to the page and takes the scroll away, whatever is transformed', () => {
    const table = { offsetTop: 2200, offsetParent: { offsetTop: 300, offsetParent: null } };
    const row = { offsetTop: 31000, offsetParent: table };
    expect(layoutTop(row, { scrollY: 33000 })).toBe(500);
    expect(layoutTop({ offsetTop: 40, offsetParent: null }, { scrollY: 0 })).toBe(40);
  });
});
