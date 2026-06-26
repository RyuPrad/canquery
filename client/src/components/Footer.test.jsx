import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import Footer from './Footer.jsx';
import { LangProvider } from '../i18n.jsx';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

// Helper: shape the raw fetch response like the real getJSON expects.
function envelopeRepo(stars) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: stars === null ? null : { stars },
      pagination: { nextCursor: null },
      meta: { source: 'github', upstream: 'api.github.com' }
    })
  };
}

describe('Footer GitHub star badge', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelopeRepo(28)))
    );
  });

  test('shows the live star count and "Star here!" hint', async () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('28')).toBeInTheDocument();
    });
    expect(screen.getByText('Star here!')).toBeInTheDocument();
    // The badge links to the repo.
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === 'https://github.com/RyuPrad/canquery')).toBe(true);
  });

  test('renders English by default and French under a fr locale', async () => {
    // English default.
    const { unmount } = render(<MemoryRouter><Footer /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Star here!')).toBeInTheDocument());
    unmount();

    // French via provider seeded from cq-lang.
    localStorage.setItem('cq-lang', 'fr');
    render(
      <MemoryRouter>
        <LangProvider>
          <Footer />
        </LangProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Étoilez-le !')).toBeInTheDocument());
    expect(screen.queryByText('Star here!')).toBeNull();
  });

  test('falls back gracefully when the star count is unavailable', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(envelopeRepo(null))));
    render(<MemoryRouter><Footer /></MemoryRouter>);
    // No numeric count, but the footer still renders without crashing and
    // keeps the "Star here!" prompt + repo link.
    await waitFor(() => expect(screen.getByText('Star here!')).toBeInTheDocument());
    expect(screen.queryByText('28')).toBeNull();
  });
});
