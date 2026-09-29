import { render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import DocsPage from './DocsPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { spawnSync } from 'node:child_process';

afterEach(() => {
  localStorage.clear();
});

test.each(['/api/v1/resources/:id/query.csv', '/api/v1/resources/:id/query'])('copied %s filters survive shell quoting', path => {
  render(<DocsPage />);
  const card = screen.getByText(path, { selector: 'code' }).closest('.cq-card');
  const command = card.querySelector('pre code').textContent;
  const shell = spawnSync('bash', ['-c', 'curl() { printf "%s\\0" "$@"; }; ' + command], { encoding: 'utf8' });
  expect(shell.status).toBe(0);
  const args = shell.stdout.split('\0').filter(Boolean);
  const url = args.find(value => value.startsWith('http'));
  const filter = args.find(value => value.startsWith('filters='))?.slice('filters='.length)
    || new URL(url).searchParams.get('filters');
  expect(JSON.parse(filter)).toEqual({ year: { op: 'gte', value: 2020 } });
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
