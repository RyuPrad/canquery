import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RouteHead from './RouteHead.jsx';

function seo(path, title, extra = '') {
  return '<!-- seo:start --><title>' + title + '</title>' +
    '<link rel="canonical" href="https://canquery.com' + path + '">' +
    '<script type="application/ld+json">{"name":"' + title + '"}</script>' + extra + '<!-- seo:end -->';
}

function response(path, title, status = 200, extra = '') {
  return {
    status, url: 'https://canquery.com' + path,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => '<html><head>' + seo(path, title, extra) + '</head></html>',
  };
}

function Navigation() {
  const navigate = useNavigate();
  return <><RouteHead />
    <Link to="/datasets/roads">Dataset</Link>
    <Link to="/resources/r1">Resource</Link>
    <Link to="/resources/r1?sort=name#table">Sort</Link>
    <button onClick={() => navigate(-1)}>Back</button>
  </>;
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="cq-analytics" content="preserve">' +
    seo('/organizations/city', 'City') + '<link rel="stylesheet" href="/assets/app.css">';
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async path =>
    response(path, path.startsWith('/datasets') ? 'Roads' : 'Resource')));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

function start() {
  render(<MemoryRouter initialEntries={['/organizations/city']}><Navigation /></MemoryRouter>);
}

test('updates title, canonical and schema through navigation and Back without touching assets or analytics', async () => {
  start();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Dataset'));
  await waitFor(() => expect(document.title).toBe('Roads'));
  expect(document.querySelector('link[rel=canonical]').href).toBe('https://canquery.com/datasets/roads');
  expect(JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent).name).toBe('Roads');
  fireEvent.click(screen.getByText('Resource'));
  await waitFor(() => expect(document.title).toBe('Resource'));
  fireEvent.click(screen.getByText('Sort'));
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText('Back'));
  fireEvent.click(screen.getByText('Back'));
  await waitFor(() => expect(document.title).toBe('Roads'));
  expect(document.querySelectorAll('title')).toHaveLength(1);
  expect(document.querySelectorAll('link[rel=canonical]')).toHaveLength(1);
  expect(document.querySelector('meta[name=cq-analytics]').content).toBe('preserve');
  expect(document.querySelector('link[rel=stylesheet]')).not.toBeNull();
});

test('aborts obsolete navigation and ignores a late response even when transport ignores abort', async () => {
  let finishOld;
  fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  start();
  fireEvent.click(screen.getByText('Dataset'));
  const oldSignal = fetch.mock.calls[0][1].signal;
  fireEvent.click(screen.getByText('Resource'));
  await waitFor(() => expect(document.title).toBe('Resource'));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finishOld(response('/datasets/roads', 'Stale roads')));
  expect(document.title).toBe('Resource');
});

test.each([404, 503])('uses the server noindex response for status %i', async status => {
  fetch.mockResolvedValue(response('/datasets/roads', 'Unavailable', status, '<meta name="robots" content="noindex">'));
  start();
  fireEvent.click(screen.getByText('Dataset'));
  await waitFor(() => expect(document.title).toBe('Unavailable'));
  expect(document.querySelector('meta[name=robots]').content).toBe('noindex');
});

test.each(['network', 'mismatched canonical', 'malformed schema'])('clears stale identity after %s', async mode => {
  if (mode === 'network') fetch.mockRejectedValue(new Error('offline'));
  if (mode === 'mismatched canonical') {
    fetch.mockResolvedValue({ ...response('/organizations/city', 'Wrong'), url: 'https://canquery.com/datasets/roads' });
  }
  if (mode === 'malformed schema') fetch.mockResolvedValue(response('/datasets/roads', 'Roads', 200,
    '<script type="application/ld+json">invalid</script>'));
  start();
  fireEvent.click(screen.getByText('Dataset'));
  await waitFor(() => expect(document.title).toBe('CanQuery'));
  expect(document.querySelector('link[rel=canonical]').href).toBe('https://canquery.com/datasets/roads');
  expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  expect(document.querySelector('meta[name=robots]')).toBeNull();
});

test('preserves translated alternates while replacing the canonical on client navigation', async () => {
  fetch.mockResolvedValue(response('/datasets/roads', 'Road guide', 200,
    '<link rel="alternate" hreflang="en-CA" href="https://canquery.com/blog/roads">' +
    '<link rel="alternate" hreflang="fr-CA" href="https://canquery.com/fr/blog/routes">'));
  start();
  fireEvent.click(screen.getByText('Dataset'));
  await waitFor(() => expect(document.title).toBe('Road guide'));
  expect(document.querySelectorAll('link[rel=canonical]')).toHaveLength(1);
  expect(document.querySelector('link[hreflang="fr-CA"]').href).toBe('https://canquery.com/fr/blog/routes');
});
