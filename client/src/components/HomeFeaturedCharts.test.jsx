import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HomeFeaturedCharts from './HomeFeaturedCharts.jsx';
import { LangProvider, useLang } from '../i18n.jsx';
import { MemoryRouter } from 'react-router-dom';
import { fetchFeatured } from '../api/catalog.js';

vi.mock('../api/catalog.js', () => ({ fetchFeatured: vi.fn() }));
vi.mock('./HeroChartWidget.jsx', () => ({ default: function Carousel({ items }) {
  const [paused, setPaused] = useState(false);
  return <div><span>{items[0].dataset_id}</span><button onClick={() => setPaused(!paused)}>{paused ? 'Resume preview' : 'Pause preview'}</button></div>;
} }));

const preview = id => ({
  dataset_id: id, title: { en: id, fr: id }, kind: 'bars',
  points: [{ key: 'A', label: 'A', value: 3 }, { key: 'B', label: 'B', value: 1 }],
  context: { resource_id: 'resource', group_by: 'status', agg: 'count', agg_column: null,
    bucket: null, group_type: 'TEXT', snapshot_at: '2026-09-29T23:30:00.000Z', snapshot_rows: 4,
    total_groups: 2, displayed_groups: 2, limited: false, missing_periods: [] },
});
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
  fetchFeatured.mockResolvedValue({ data: [preview('english-preview')] });
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
  expect(fetchFeatured).not.toHaveBeenCalled();
  expect(observers[0].options).toEqual({ rootMargin: '800px 0px' });
  expect(screen.getByRole('region', { name: 'Loading...' })).toHaveClass('cq-home-featured-slot');
  await approach();
  expect(await screen.findByText('english-preview')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
  await act(() => observers[0].callback([{ isIntersecting: false }]));
  view.rerender(component(true));
  expect(screen.getByRole('button', { name: 'Resume preview' })).toBeInTheDocument();
  expect(fetchFeatured).toHaveBeenCalledTimes(1);
  expect(observers[0].disconnect).toHaveBeenCalled();
});

test('filtered visits start no featured request and an obsolete request cannot replace the cleared visit', async () => {
  const view = render(component(false));
  expect(observers).toHaveLength(0);
  expect(fetchFeatured).not.toHaveBeenCalled();
  let finishOld;
  fetchFeatured.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  view.rerender(component(true));
  await approach();
  const firstSignal = fetchFeatured.mock.calls[0][1].signal;
  view.rerender(component(false));
  expect(firstSignal.aborted).toBe(true);
  expect(screen.queryByRole('region')).toBeNull();
  expect(fetchFeatured).toHaveBeenCalledTimes(1);
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
  fetchFeatured.mockResolvedValueOnce({ data: [preview('french-preview')] });
  fireEvent.click(screen.getByRole('button', { name: 'French preview' }));
  expect(await screen.findByText('french-preview')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume preview' })).toBeInTheDocument();
  expect(fetchFeatured).toHaveBeenLastCalledWith('fr', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test('a slow English response cannot overwrite a newly selected French preview', async () => {
  let finishEnglish;
  fetchFeatured.mockImplementationOnce(() => new Promise(resolve => { finishEnglish = resolve; }));
  render(component(true));
  await approach();
  fetchFeatured.mockResolvedValueOnce({ data: [preview('french-preview')] });
  fireEvent.click(screen.getByRole('button', { name: 'French preview' }));
  expect(await screen.findByText('french-preview')).toBeInTheDocument();
  await act(async () => finishEnglish({ data: [preview('old-english-preview')] }));
  expect(screen.queryByText('old-english-preview')).toBeNull();
});

test.each([null, { data: [] }])('an empty response settles a visible slot without removing its space (%j)', async response => {
  fetchFeatured.mockResolvedValue(response);
  render(component(true));
  await approach();
  expect(await screen.findByText('No chart previews are available yet.')).toBeInTheDocument();
  expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('region')).toHaveClass('cq-home-featured-slot');
  expect(screen.getByRole('link', { name: 'Explore insights' })).toHaveAttribute('href', '/insights');
  expect(screen.queryByText('Pause preview')).toBeNull();
});

test('an empty response can remove a reserved slot that has not reached the viewport', async () => {
  fetchFeatured.mockResolvedValue({ data: [] });
  render(component(true));
  screen.getByRole('region').getBoundingClientRect = () => ({ top: 2000 });
  await approach();
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
});

test('a failed visible preview settles with localized feedback rather than a loading placeholder', async () => {
  localStorage.setItem('cq-lang', 'fr');
  fetchFeatured.mockRejectedValue(new Error('Unavailable'));
  render(component(true));
  await approach();
  expect(await screen.findByText('Les aperçus graphiques sont temporairement indisponibles.')).toBeInTheDocument();
  expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByRole('link', { name: 'Explorer les aperçus' })).toHaveAttribute('href', '/insights');
});
