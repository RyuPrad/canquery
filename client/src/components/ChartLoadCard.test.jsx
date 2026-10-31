import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ChartLoadCard from './ChartLoadCard.jsx';
import { createChartLoadStore } from '../hooks/useChartLoadReport.js';
import { LangProvider } from '../i18n.jsx';

const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('ChartLoadCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('stands in for the preparation at once and counts up through its steps', () => {
    const store = createChartLoadStore();
    const props = { store, preparing: true, charting: false, published: false, phase: 'pending', progress: null, elapsed: '0:01' };
    const { rerender } = render(<ChartLoadCard {...props} />);
    const bar = screen.getByRole('progressbar', { name: 'Building the chart…' });
    expect(screen.getByText('Waiting in the preparation queue…')).toBeInTheDocument();
    expect(screen.getByText('Loading for 0:01')).toBeInTheDocument();
    advance(2000);
    const queued = Number(bar.getAttribute('value'));
    expect(queued).toBeGreaterThan(0);

    rerender(<ChartLoadCard {...props} phase="running" progress={{ phase: 'downloading', bytes: 2_000_000, content_length: 8_000_000 }} />);
    expect(screen.getByText('Downloading 2.0 MB of 8.0 MB')).toBeInTheDocument();
    advance(1000);
    const downloading = Number(bar.getAttribute('value'));
    expect(downloading).toBeGreaterThan(queued);

    rerender(<ChartLoadCard {...props} phase="running" progress={{ phase: 'loading', rows: 41000, read_fraction: 0.5 }} />);
    expect(screen.getByText('Loading rows: 41,000')).toBeInTheDocument();
    advance(1000);
    const loading = Number(bar.getAttribute('value'));
    expect(loading).toBeGreaterThan(downloading);
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringMatching(/^\d+% · Loading rows: 41,000$/));

    // The job is done and fresh metadata is on its way: no step back.
    rerender(<ChartLoadCard {...props} phase="idle" published progress={null} elapsed={null} />);
    expect(screen.getByText('Opening the chart…')).toBeInTheDocument();
    expect(Number(bar.getAttribute('value'))).toBeGreaterThanOrEqual(loading);
  });

  test('over the charts: hidden for a moment, 100% only once every chart settled, then gone', () => {
    const store = createChartLoadStore();
    act(() => { store.set('p', 'profile', 'loading'); });
    render(<ChartLoadCard store={store} preparing={false} charting published={false} phase="idle" progress={null} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    advance(400);
    expect(screen.getByText('Reading the columns…')).toBeInTheDocument();
    act(() => {
      store.set('p', 'profile', 'settled');
      store.set('c1', 'chart', 'loading');
      store.set('c2', 'chart', 'loading');
    });
    expect(screen.getByText('Drawing charts: 0 of 2')).toBeInTheDocument();
    act(() => { store.set('c1', 'chart', 'settled'); });
    advance(400);
    expect(screen.getByText('Drawing charts: 1 of 2')).toBeInTheDocument();
    expect(Number(screen.getByRole('progressbar').getAttribute('value'))).toBeLessThan(100);
    act(() => { store.set('c2', 'chart', 'settled'); });
    advance(200);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(screen.getByText('Chart ready', { selector: 'span' })).toBeInTheDocument();
    advance(800);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('a quick load never shows the card, and a profile error ends it without 100%', () => {
    const store = createChartLoadStore();
    act(() => { store.set('p', 'profile', 'loading'); });
    render(<ChartLoadCard store={store} preparing={false} charting published={false} phase="idle" progress={null} />);
    advance(100);
    act(() => { store.set('p', 'profile', 'settled'); });
    advance(1000);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    act(() => { store.set('q', 'chart', 'loading'); });
    advance(600);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    act(() => { store.set('p', 'profile', 'failed'); });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('speaks French with its own number format and announces only lasting steps', () => {
    localStorage.setItem('cq-lang', 'fr');
    const store = createChartLoadStore();
    render(
      <LangProvider>
        <ChartLoadCard store={store} preparing charting={false} published={false} phase="requesting" progress={null} />
      </LangProvider>
    );
    expect(screen.getByRole('progressbar', { name: 'Création du graphique…' })).toBeInTheDocument();
    expect(screen.getByText('Démarrage de la préparation…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
    advance(1000);
    expect(screen.getByText(/^\d+\s%$/u)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('En attente dans la file de préparation…');
  });

  test('with reduced motion the number jumps straight to its value', () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    try {
      const store = createChartLoadStore();
      render(<ChartLoadCard store={store} preparing charting={false} published={false} phase="running" progress={{ phase: 'downloading', bytes: 9, content_length: 10 }} />);
      advance(1000);
      const first = Number(screen.getByRole('progressbar').getAttribute('value'));
      advance(1000);
      expect(Number(screen.getByRole('progressbar').getAttribute('value'))).toBe(first);
      expect(first).toBeGreaterThan(20);
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
