import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HomeFeaturedCharts from './HomeFeaturedCharts.jsx';
import { LangProvider, useLang } from '../i18n.jsx';
import { MemoryRouter } from 'react-router-dom';
import { fetchInsightCards } from '../api/catalog.js';
import { SHARE } from '../test/chartAnalysis.js';

vi.mock('../api/catalog.js', () => ({ fetchInsightCards: vi.fn() }));
vi.mock('./HeroChartWidget.jsx', () => ({ default: function Carousel({ items }) {
  const [paused, setPaused] = useState(false);
  return <div><span>{items[0].dataset_id}</span><button onClick={() => setPaused(!paused)}>{paused ? 'Resume preview' : 'Pause preview'}</button></div>;
} }));

// A chart card of the engine, as GET /web-api/v1/insights/charts answers.
const preview = id => ({ dataset_id: id, title: { en: id, fr: id }, resource_id: 'resource', snapshot_at: '2026-09-29T23:30:00.000Z',
  rows: 288, kpis: [], chart: SHARE });
let observers;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe = vi.fn();
    disconnect = vi.fn();
  });
  fetchInsightCards.mockResolvedValue({ data: [preview('english-preview')] });
});
afterEach(() => vi.unstubAllGlobals());
function ChangeLanguage() {
  const { setLang } = useLang();
  return <button onClick={() => setLang('fr')}>French preview</button>;
}
const component = enabled => <MemoryRouter><LangProvider><ChangeLanguage /><HomeFeaturedCharts enabled={enabled} /></LangProvider></MemoryRouter>;
const approach = () => act(() => observers.at(-1).callback([{ isIntersecting: true }]));

test('defers featured work until the section approaches, then keeps the carousel mounted offscreen', async () => {
  const view = render(component(true));
  expect(fetchInsightCards).not.toHaveBeenCalled();
  expect(observers[0].options).toEqual({ rootMargin: '800px 0px' });
  expect(screen.getByRole('region', { name: 'Loading...' })).toHaveClass('cq-home-featured-slot');
  await approach();
  expect(await screen.findByText('english-preview')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
  await act(() => observers[0].callback([{ isIntersecting: false }]));
  view.rerender(component(true));
  expect(screen.getByRole('button', { name: 'Resume preview' })).toBeInTheDocument();
  expect(fetchInsightCards).toHaveBeenCalledTimes(1);
  expect(observers[0].disconnect).toHaveBeenCalled();
});

test('filtered visits start no featured request and an obsolete request cannot replace the cleared visit', async () => {
  const view = render(component(false));
  expect(observers).toHaveLength(0);
  expect(fetchInsightCards).not.toHaveBeenCalled();
  let finishOld;
  fetchInsightCards.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  view.rerender(component(true));
  await approach();
  const firstSignal = fetchInsightCards.mock.calls[0][1].signal;
  view.rerender(component(false));
  expect(firstSignal.aborted).toBe(true);
  expect(screen.queryByRole('region')).toBeNull();
  expect(fetchInsightCards).toHaveBeenCalledTimes(1);
  view.rerender(component(true));
  expect(await screen.findByText('english-preview')).toBeInTheDocument();
  await act(async () => finishOld({ data: [preview('obsolete-preview')] }));
  expect(screen.queryByText('obsolete-preview')).toBeNull();
});

test('language changes ignore obsolete data and preserve an already visible carousel pause', async () => {
  render(component(true));
  await approach();
  await screen.findByText('english-preview');
  fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
  fetchInsightCards.mockResolvedValueOnce({ data: [preview('french-preview')] });
  fireEvent.click(screen.getByRole('button', { name: 'French preview' }));
  expect(await screen.findByText('french-preview')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume preview' })).toBeInTheDocument();
  expect(fetchInsightCards).toHaveBeenLastCalledWith('fr', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test('a slow English response cannot overwrite a newly selected French preview', async () => {
  let finishEnglish;
  fetchInsightCards.mockImplementationOnce(() => new Promise(resolve => { finishEnglish = resolve; }));
  render(component(true));
  await approach();
  fetchInsightCards.mockResolvedValueOnce({ data: [preview('french-preview')] });
  fireEvent.click(screen.getByRole('button', { name: 'French preview' }));
  expect(await screen.findByText('french-preview')).toBeInTheDocument();
  await act(async () => finishEnglish({ data: [preview('old-english-preview')] }));
  expect(screen.queryByText('old-english-preview')).toBeNull();
});

test.each([{ data: [] }])('an empty response settles a visible slot without removing its space (%j)', async response => {
  fetchInsightCards.mockResolvedValue(response);
  render(component(true));
  await approach();
  expect(await screen.findByText('No chart previews are available yet.')).toBeInTheDocument();
  expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('region')).toHaveClass('cq-home-featured-slot');
  expect(screen.getByRole('link', { name: 'Explore insights' })).toHaveAttribute('href', '/insights');
  expect(screen.queryByText('Pause preview')).toBeNull();
});

test('an empty response can remove a reserved slot that has not reached the viewport', async () => {
  fetchInsightCards.mockResolvedValue({ data: [] });
  render(component(true));
  screen.getByRole('region').getBoundingClientRect = () => ({ top: 2000 });
  await approach();
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
});

test('a failed visible preview settles with localized feedback rather than a loading placeholder', async () => {
  localStorage.setItem('cq-lang', 'fr');
  fetchInsightCards.mockRejectedValue(new Error('Unavailable'));
  render(component(true));
  await approach();
  expect(await screen.findByText('Les aperçus graphiques sont temporairement indisponibles.')).toBeInTheDocument();
  expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('link', { name: 'Explorer les aperçus' })).toHaveAttribute('href', '/insights');
});
