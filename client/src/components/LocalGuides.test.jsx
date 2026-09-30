import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { LangProvider, useLang } from '../i18n.jsx';
import LocalGuides from './LocalGuides.jsx';

vi.mock('../api/catalog.js', () => ({ fetchBlog: vi.fn() }));
import { fetchBlog } from '../api/catalog.js';

const guides = (lang = 'en', count = 6) => Array.from({ length: count }, (_, index) => ({
  id: 'guide-' + index,
  title: (lang === 'fr' ? 'Guide français ' : 'Guide ') + (index + 1),
  description: 'A complete description of the guide and its exploration steps.',
  path: (lang === 'fr' ? '/fr' : '') + '/blog/guide-' + index,
  place: 'oshawa-on', placeName: 'Oshawa', topic: 'parks', topicName: 'Parks', query: 'parks & gardens',
}));

function LanguageControl() {
  const { setLang } = useLang();
  return <button onClick={() => setLang('fr')}>French</button>;
}

function start(props = {}) {
  return render(<MemoryRouter><LangProvider><LanguageControl /><LocalGuides {...props} /></LangProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fetchBlog.mockImplementation(async ({ lang }) => ({ data: guides(lang) }));
});

test('keeps the complete related-guide list by default', async () => {
  start();
  expect(await screen.findByRole('heading', { name: 'Guide 6' })).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(6);
  expect(fetchBlog).toHaveBeenCalledWith({ lang: 'en', place: undefined, dataset: undefined });
  expect(screen.getByRole('link', { name: 'Data guides →' })).toHaveAttribute('href', '/blog');
});

test('limits homepage cards without limiting the API request or truncating guide titles', async () => {
  const title = 'A long guide title that stays readable when it wraps on a narrow screen';
  fetchBlog.mockResolvedValue({ data: guides().map((article, index) => index === 0 ? { ...article, title } : article) });
  start({ limit: 3, variant: 'compact' });
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(screen.queryByRole('heading', { name: 'Guide 4' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: title })).not.toHaveClass('line-clamp-2');
  const first = screen.getAllByRole('article')[0];
  expect(within(first).getByText(guides()[0].description)).toHaveClass('line-clamp-2');
  expect(within(first).getByRole('link', { name: 'Read the guide →' })).toHaveAttribute('href', '/blog/guide-0');
  const exploration = new URL(within(first).getByRole('link', { name: 'Oshawa · Parks' }).href);
  expect(exploration.searchParams.get('place')).toBe('oshawa-on');
  expect(exploration.searchParams.get('q')).toBe('parks & gardens');
  expect(fetchBlog).toHaveBeenCalledWith({ lang: 'en', place: undefined, dataset: undefined });
});

test('preserves scoped requests and translated guide/index links with a limit', async () => {
  start({ place: 'oshawa-on', dataset: 'parks', limit: 3, variant: 'compact' });
  expect(await screen.findByRole('heading', { name: 'Guide 1' })).toBeInTheDocument();
  expect(fetchBlog).toHaveBeenLastCalledWith({ lang: 'en', place: 'oshawa-on', dataset: 'parks' });
  fireEvent.click(screen.getByRole('button', { name: 'French' }));
  expect(await screen.findByRole('heading', { name: 'Guide français 1' })).toBeInTheDocument();
  expect(fetchBlog).toHaveBeenLastCalledWith({ lang: 'fr', place: 'oshawa-on', dataset: 'parks' });
  expect(screen.getByRole('link', { name: 'Guides des données →' })).toHaveAttribute('href', '/fr/blog');
  expect(screen.getAllByRole('link', { name: 'Lire le guide →' })).toHaveLength(3);
  expect(screen.getByRole('link', { name: 'Guide français 1' })).toHaveAttribute('href', '/fr/blog/guide-0');
});

test('ignores obsolete guide responses after the language changes', async () => {
  let finishEnglish;
  fetchBlog.mockImplementation(({ lang }) => lang === 'en'
    ? new Promise(resolve => { finishEnglish = resolve; })
    : Promise.resolve({ data: guides('fr') }));
  start({ limit: 3 });
  await waitFor(() => expect(fetchBlog).toHaveBeenCalledWith({ lang: 'en', place: undefined, dataset: undefined }));
  fireEvent.click(screen.getByRole('button', { name: 'French' }));
  expect(await screen.findByRole('heading', { name: 'Guide français 1' })).toBeInTheDocument();
  await act(async () => finishEnglish({ data: guides() }));
  expect(screen.queryByRole('heading', { name: 'Guide 1' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(3);
});

test.each(['empty', 'failed'])('an %s response leaves the guide section absent', async outcome => {
  if (outcome === 'empty') fetchBlog.mockResolvedValue({ data: [] });
  else fetchBlog.mockRejectedValue(new Error('Unavailable'));
  start({ limit: 3 });
  await act(async () => {});
  expect(screen.queryByRole('region', { name: 'Data guides' })).not.toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
