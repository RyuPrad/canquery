import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import ScrollManager from './ScrollManager.jsx';
import { createScrollMemory } from '../utils/scrollMemory.js';

const router = { navigate: null };
const navigate = (...args) => router.navigate(...args);
function Driver() {
  const go = useNavigate();
  useEffect(() => {
    router.navigate = go;
  }, [go]);
  return null;
}

let y;
let height;
const scrollWindow = (to) => {
  y = to;
  window.dispatchEvent(new Event('scroll'));
};
function setup({ initial = '/datasets/a', memory = createScrollMemory(null), restored = false } = {}) {
  const view = render(
    <MemoryRouter initialEntries={[initial]}>
      <ScrollManager memory={memory} restored={restored} />
      <Driver />
    </MemoryRouter>
  );
  return { memory, view };
}

beforeEach(() => {
  y = 0;
  height = 9000;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height });
  window.scrollTo = vi.fn((x, top) => scrollWindow(top));
  window.history.scrollRestoration = 'auto';
});
afterEach(() => {
  delete window.scrollY;
  delete document.documentElement.scrollHeight;
});

describe('ScrollManager', () => {
  test("turns the browser's own restoration off while the app runs and back on when the page is hidden", () => {
    setup();
    expect(window.history.scrollRestoration).toBe('manual');
    window.dispatchEvent(new Event('pagehide'));
    expect(window.history.scrollRestoration).toBe('auto');
    const shown = new Event('pageshow');
    shown.persisted = true;
    window.dispatchEvent(shown);
    expect(window.history.scrollRestoration).toBe('manual');
  });

  test('a link to another page starts at the top', () => {
    setup();
    scrollWindow(1200);
    act(() => navigate('/resources/r1'));
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
    expect(y).toBe(0);
  });

  test("the table's pages, a sort or a filter written over the entry keep the window where it is", () => {
    setup({ initial: '/resources/r1' });
    scrollWindow(976);
    window.scrollTo.mockClear();
    act(() => navigate('/resources/r1?page=1', { replace: true }));
    act(() => navigate('/resources/r1?page=6', { replace: true }));
    act(() => navigate('/resources/r1?sort=year+asc', { replace: true }));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(y).toBe(976);
  });

  test('a catalogue page link still starts at the top', () => {
    setup();
    scrollWindow(6947);
    act(() => navigate('/datasets/a?page=2'));
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  test('Back and Forward return to where the visitor was, once the page is tall enough', async () => {
    setup();
    scrollWindow(4498);
    act(() => navigate('/resources/r1'));
    scrollWindow(976);
    act(() => navigate('/resources/r1?page=1', { replace: true }));
    // The dataset page comes back while it still loads.
    height = 1000;
    act(() => navigate(-1));
    expect(y).toBe(976);
    height = 6000;
    await waitFor(() => expect(y).toBe(4498));
    act(() => navigate(1));
    await waitFor(() => expect(y).toBe(976));
  });

  test('a visitor who scrolls while a page comes back keeps the position they chose', async () => {
    setup();
    scrollWindow(4498);
    act(() => navigate('/resources/r1'));
    height = 1000;
    act(() => navigate(-1));
    window.dispatchEvent(new Event('wheel'));
    scrollWindow(150);
    height = 6000;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(y).toBe(150);
    // That position is the one remembered for the entry.
    act(() => navigate('/resources/r2'));
    act(() => navigate(-1));
    await waitFor(() => expect(y).toBe(150));
  });

  test('positions survive a reload through session storage', async () => {
    const data = {};
    const storage = { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
    const first = setup({ memory: createScrollMemory(storage) });
    scrollWindow(6947);
    window.dispatchEvent(new Event('pagehide'));
    first.view.unmount();
    y = 0;
    window.scrollTo.mockClear();
    setup({ memory: createScrollMemory(storage), restored: true });
    await waitFor(() => expect(y).toBe(6947));
  });

  test('a fresh visit to an address seen before starts at the top', () => {
    const memory = createScrollMemory(null);
    memory.set('default:/datasets/a', '/datasets/a', 6947);
    setup({ memory, restored: false });
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });
});
