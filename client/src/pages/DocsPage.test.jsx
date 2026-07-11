import { render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import DocsPage from './DocsPage.jsx';
import { LangProvider } from '../i18n.jsx';

afterEach(() => {
  localStorage.clear();
});

describe('DocsPage i18n', () => {
  test('renders English prose by default', () => {
    render(<DocsPage />);
    expect(screen.getByRole('heading', { name: 'API documentation' })).toBeInTheDocument();
    expect(screen.getByText(/Catalogue totals/)).toBeInTheDocument();
    expect(screen.getByText(/Returns 202 with a job to poll/)).toBeInTheDocument();
  });

  test('renders French prose when the locale is French', () => {
    // LangProvider seeds its language from cq-lang on mount.
    localStorage.setItem('cq-lang', 'fr');
    render(
      <LangProvider>
        <DocsPage />
      </LangProvider>
    );
    // Heading and an endpoint description both follow the toggle.
    expect(screen.getByRole('heading', { name: /Documentation de l/ })).toBeInTheDocument();
    expect(screen.getByText(/Totaux du catalogue/)).toBeInTheDocument();
    expect(screen.getByText(/Renvoie 202 avec une tâche à interroger/)).toBeInTheDocument();
    // The English copy is gone, not just sitting alongside the French.
    expect(screen.queryByRole('heading', { name: 'API documentation' })).toBeNull();
    expect(screen.queryByText(/Catalogue totals/)).toBeNull();
  });
});
