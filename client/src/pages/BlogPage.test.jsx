import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import BlogPage from './BlogPage.jsx';
import Navbar from '../components/Navbar.jsx';
import { LangProvider } from '../i18n.jsx';
import { ThemeProvider } from '../theme.jsx';
import { NotFoundError } from '../api/client.js';

vi.mock('../api/catalog.js', () => ({ fetchBlog: vi.fn(), fetchBlogArticle: vi.fn() }));
import { fetchBlog, fetchBlogArticle } from '../api/catalog.js';
const article = lang => ({ id: 'parks', lang, title: lang === 'fr' ? 'Les parcs de la ville' : 'City parks guide',
  description: 'A practical guide', place: 'oshawa-on', placeName: 'Oshawa', topic: 'parks', topicName: 'Parks',
  published: '2026-09-09', updated: '2026-09-09', verified: '2026-09-09',
  path: lang === 'fr' ? '/fr/blog/parcs' : '/blog/parks',
  translations: { en: '/blog/parks', fr: '/fr/blog/parcs' },
  explore: '/resources/park-map?view=map', view: 'map', dataset: '/datasets/parks',
  bodyHtml: '<h2>Read the boundaries</h2><p>Complete instructions and source limitations.</p>' });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fetchBlog.mockImplementation(async ({ lang }) => ({ data: [article(lang)] }));
  fetchBlogArticle.mockImplementation(async lang => ({ data: article(lang) }));
});

function Back() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Back</button>;
}
function start(path) {
  render(<MemoryRouter initialEntries={[path]}><ThemeProvider><LangProvider><Navbar /><Back /><Routes>
    <Route path="/blog" element={<BlogPage />} />
    <Route path="/blog/:slug" element={<BlogPage />} />
    <Route path="/fr/blog" element={<BlogPage language="fr" />} />
    <Route path="/fr/blog/:slug" element={<BlogPage language="fr" />} />
    <Route path="/" element={<h1>Canadian open data search</h1>} />
  </Routes></LangProvider></ThemeProvider></MemoryRouter>);
}

test('renders the full article, dates, attribution and the actual map action', async () => {
  start('/blog/parks');
  expect(await screen.findByRole('heading', { name: 'City parks guide' })).toBeInTheDocument();
  expect(screen.getByText('Complete instructions and source limitations.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Explore map/ })).toHaveAttribute('href', '/resources/park-map?view=map');
  expect(screen.getByRole('link', { name: 'View the source dataset' })).toHaveAttribute('href', '/datasets/parks');
  expect(document.querySelectorAll('time')).toHaveLength(3);
});

test('the URL determines article language, including navbar switching and Back', async () => {
  localStorage.setItem('cq-lang', 'en');
  start('/fr/blog/parcs');
  expect(await screen.findByRole('heading', { name: 'Les parcs de la ville' })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe('fr');
  fireEvent.click(screen.getByRole('button', { name: 'EN', exact: true }));
  expect(await screen.findByRole('heading', { name: 'City parks guide' })).toBeInTheDocument();
  expect(fetchBlogArticle).toHaveBeenLastCalledWith('en', 'parks');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(document.documentElement.lang).toBe('fr'));
  expect(await screen.findByRole('heading', { name: 'Les parcs de la ville' })).toBeInTheDocument();
});

test.each([
  { path: '/blog/parks', title: 'City parks guide', cta: 'Search more Canadian open data' },
  { path: '/fr/blog/parcs', title: 'Les parcs de la ville', cta: 'Rechercher d’autres données ouvertes canadiennes' },
])('the $path guide links back to Canadian open data search after its source and place links', async ({ path, title, cta }) => {
  start(path);
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  const link = screen.getByRole('link', { name: cta });
  expect(link).toHaveAttribute('href', '/?place=oshawa-on');
  const guideLinks = Array.from(link.closest('aside').querySelectorAll('a')).map(anchor => anchor.getAttribute('href'));
  expect(guideLinks).toEqual(['/resources/park-map?view=map', '/datasets/parks', '/places/oshawa-on', '/?place=oshawa-on']);
  fireEvent.click(link);
  expect(await screen.findByRole('heading', { name: 'Canadian open data search' })).toBeInTheDocument();
});

test('the blog index links to complete guides', async () => {
  start('/blog');
  expect(await screen.findByRole('heading', { name: 'Data guides' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'City parks guide' }));
  expect(await screen.findByRole('heading', { name: 'Read the boundaries' })).toBeInTheDocument();
});

test('a national download guide has no place links and opens explicit download details', async () => {
  fetchBlogArticle.mockResolvedValue({ data: { ...article('en'), place: undefined, placeName: undefined,
    view: 'download', explore: '/resources/archive' } });
  start('/blog/parks');
  expect(await screen.findByRole('heading', { name: 'City parks guide' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View download details/ })).toHaveAttribute('href', '/resources/archive');
  expect(document.querySelector('a[href^="/places/"]')).toBeNull();
  expect(screen.getByRole('link', { name: 'Search more Canadian open data' })).toHaveAttribute('href', '/');
});

test('language switching remains available after an article fails to load', async () => {
  fetchBlogArticle.mockRejectedValue(new NotFoundError('Missing article'));
  start('/blog/missing');
  expect(await screen.findByRole('heading', { name: 'Guide not found' })).toBeInTheDocument();
  const french = screen.getByRole('button', { name: 'FR', exact: true });
  expect(french).toBeEnabled();
  fireEvent.click(french);
  expect(await screen.findByRole('heading', { name: 'Guides des données' })).toBeInTheDocument();
});

test('lists related guides for the same place or topic and scopes the search link to the place', async () => {
  const guides = [article('en'),
    { ...article('en'), id: 'oshawa-permits', title: 'Oshawa permits guide', path: '/blog/oshawa-permits', topic: 'permits', published: '2026-09-10' },
    { ...article('en'), id: 'toronto-parks', title: 'Toronto parks guide', path: '/blog/toronto-parks', place: 'toronto-on', placeName: 'Toronto', published: '2026-09-11' },
    { ...article('en'), id: 'toronto-transit', title: 'Toronto transit guide', path: '/blog/toronto-transit', place: 'toronto-on', placeName: 'Toronto', topic: 'transit' }];
  fetchBlog.mockResolvedValue({ data: guides });
  start('/blog/parks');
  expect(await screen.findByRole('heading', { name: 'City parks guide' })).toBeInTheDocument();
  const related = await screen.findByRole('region', { name: 'Related guides' });
  const links = Array.from(related.querySelectorAll('a')).map(link => link.textContent);
  expect(links).toEqual(['Oshawa permits guide', 'Toronto parks guide']);
  expect(screen.getByRole('link', { name: 'Search more Canadian open data' })).toHaveAttribute('href', '/?place=oshawa-on');
});

function embed(payload) {
  const block = document.createElement('script');
  block.type = 'application/json';
  block.id = 'cq-initial';
  block.textContent = JSON.stringify(payload);
  document.body.append(block);
  return block;
}
const otherGuide = (lang) => ({ ...article(lang), id: 'trails', slug: 'trails', path: '/blog/trails', title: 'City trails guide' });

test('a direct visit draws the article its HTML carries on the first render, with no request and no loading state', () => {
  embed({ version: 1, kind: 'guide', path: '/blog/parks', lang: 'en',
    article: { data: { ...article('en'), slug: 'parks' } }, guides: { data: [{ ...article('en'), slug: 'parks' }, otherGuide('en')] } });
  start('/blog/parks');
  // Synchronously, before any effect or request: the page the server sent.
  expect(screen.getByRole('heading', { name: 'City parks guide' })).toBeInTheDocument();
  expect(screen.getByText('Complete instructions and source limitations.')).toBeInTheDocument();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('link', { name: 'City trails guide' })).toHaveAttribute('href', '/blog/trails');
  expect(fetchBlogArticle).not.toHaveBeenCalled();
  expect(fetchBlog).not.toHaveBeenCalled();
  expect(document.getElementById('cq-initial')).toBeNull();
});

test('a direct visit to an index draws its list from the HTML block', () => {
  embed({ version: 1, kind: 'guides', path: '/fr/blog', lang: 'fr', guides: { data: [{ ...article('fr'), slug: 'parcs' }] } });
  start('/fr/blog');
  expect(screen.getByRole('link', { name: 'Les parcs de la ville' })).toHaveAttribute('href', '/fr/blog/parcs');
  expect(fetchBlog).not.toHaveBeenCalled();
});

test.each([
  ['another page', { path: '/blog/other' }],
  ['another language', { lang: 'fr' }],
  ['another guide', { article: { data: { ...article('en'), slug: 'trails' } } }],
  ['an older version', { version: 0 }],
  ['an article without its body', { article: { data: { ...article('en'), slug: 'parks', bodyHtml: null } } }]
])('a block for %s is removed and the page fetches as before', async (_name, change) => {
  embed({ version: 1, kind: 'guide', path: '/blog/parks', lang: 'en',
    article: { data: { ...article('en'), slug: 'parks' } }, guides: { data: [article('en')] }, ...change });
  start('/blog/parks');
  expect(await screen.findByRole('heading', { name: 'City parks guide' })).toBeInTheDocument();
  expect(fetchBlogArticle).toHaveBeenCalledWith('en', 'parks');
  expect(document.getElementById('cq-initial')).toBeNull();
});

test('after a direct visit, opening another guide fetches it', async () => {
  embed({ version: 1, kind: 'guide', path: '/blog/parks', lang: 'en',
    article: { data: { ...article('en'), slug: 'parks' } }, guides: { data: [{ ...article('en'), slug: 'parks' }, otherGuide('en')] } });
  fetchBlogArticle.mockImplementation(async (lang, slug) => ({ data: slug === 'trails' ? otherGuide(lang) : article(lang) }));
  start('/blog/parks');
  fireEvent.click(screen.getByRole('link', { name: 'City trails guide' }));
  expect(await screen.findByRole('heading', { name: 'City trails guide' })).toBeInTheDocument();
  expect(fetchBlogArticle).toHaveBeenCalledWith('en', 'trails');
});
