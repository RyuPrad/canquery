import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { lazyPage } from './lazyPage.js';
import PageLoadBoundary from '../components/PageLoadBoundary.jsx';
import { LangProvider } from '../i18n.jsx';

const Fallback = () => <span>skeleton</span>;
const page = (text) => () => Promise.resolve({ default: ({ suffix = '' }) => <h1>{text + suffix}</h1> });

describe('preloaded route pages', () => {
  test('a preloaded page renders in the first commit, with no skeleton', async () => {
    const Page = lazyPage(page('Resource page'));
    await Page.preload();
    render(<Suspense fallback={<Fallback />}><Page suffix="!" /></Suspense>);
    expect(screen.getByRole('heading', { name: 'Resource page!' })).toBeInTheDocument();
    expect(screen.queryByText('skeleton')).toBeNull();
  });

  test('a page not preloaded still loads on demand behind the skeleton', async () => {
    const Page = lazyPage(page('Dataset page'));
    render(<Suspense fallback={<Fallback />}><Page /></Suspense>);
    expect(screen.getByText('skeleton')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Dataset page' })).toBeInTheDocument();
  });

  test('a page whose code fails to load says so instead of blanking the app', async () => {
    const Page = lazyPage(() => Promise.reject(new Error('chunk gone')));
    const quiet = console.error;
    console.error = () => {};
    try {
      render(
        <LangProvider>
          <PageLoadBoundary resetKey="/about">
            <Suspense fallback={<Fallback />}><Page /></Suspense>
          </PageLoadBoundary>
        </LangProvider>
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be loaded.');
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    } finally {
      console.error = quiet;
    }
    // A failed load can be tried again.
    await act(async () => {
      await expect(Page.preload()).rejects.toThrow('chunk gone');
    });
  });
});
