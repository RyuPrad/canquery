import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import BlogPage from './BlogPage.jsx';
import Navbar from '../components/Navbar.jsx';
import { LangProvider } from '../i18n.jsx';
import { ThemeProvider } from '../theme.jsx';

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
});
