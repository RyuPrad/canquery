import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import QuietPageGuard from './QuietPageGuard.jsx';

vi.mock('../utils/quietPages.js', async (original) => ({ ...(await original()), reloadDocument: vi.fn() }));
import { reloadDocument } from '../utils/quietPages.js';

// The router's navigate, handed out once the tree is drawn.
const router = { go: null };
function Go() {
  const navigate = useNavigate();
  useEffect(() => { router.go = navigate; });
  return null;
}
const open = (path, openedQuiet) => render(<MemoryRouter initialEntries={[path]}><QuietPageGuard openedQuiet={openedQuiet} /><Go /></MemoryRouter>);
const visit = (path) => act(() => { router.go(path); });
const meta = (name) => {
  const element = document.createElement('meta');
  element.name = name;
  element.content = 'x';
  document.head.appendChild(element);
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { document.head.querySelectorAll('meta[name]').forEach((element) => element.remove()); });

test('another page reached from a document that opened on a lookup page is loaded as its own document', () => {
  meta('google-adsense-account');
  open('/oas', true);
  expect(reloadDocument).not.toHaveBeenCalled();
  // Between the hub, its tables and their French twins nothing is reloaded.
  for (const path of ['/oas/table-2', '/fr/sv/tableau-2', '/fr/sv']) {
    visit(path);
    expect(reloadDocument).not.toHaveBeenCalled();
  }
  visit('/datasets/dfa4daf1-669e-4514-82cd-982f27707ed0');
  expect(reloadDocument).toHaveBeenCalledTimes(1);
});

test('with analytics only, the same', () => {
  meta('canquery-analytics-site');
  open('/fr/sv/tableau-1', true);
  visit('/blog/guaranteed-income-supplement-amounts');
  expect(reloadDocument).toHaveBeenCalledTimes(1);
});

test('a site with neither ads nor analytics never reloads', () => {
  open('/oas', true);
  visit('/datasets');
  expect(reloadDocument).not.toHaveBeenCalled();
});

test('a document that opened on any other page is left to the lookup page itself', () => {
  meta('google-adsense-account');
  open('/datasets', false);
  for (const path of ['/oas', '/oas/table-1', '/datasets', '/lmia']) visit(path);
  expect(reloadDocument).not.toHaveBeenCalled();
});
