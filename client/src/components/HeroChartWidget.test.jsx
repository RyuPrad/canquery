import { describe, expect, test, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HeroChartWidget from './HeroChartWidget.jsx';

const items = [
  { dataset_id: 'd1', title: { en: 'Alpha dataset' }, kind: 'bars', points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] },
  { dataset_id: 'd2', title: { en: 'Beta dataset' }, kind: 'donut', points: [{ label: 'x', value: 3 }, { label: 'y', value: 1 }] },
];

const renderW = (props = {}) => render(<MemoryRouter><HeroChartWidget items={items} {...props} /></MemoryRouter>);

describe('HeroChartWidget', () => {
  test('shows the first item and deep-links to /insights?focus', () => {
    renderW({ reduced: true });
    expect(screen.getByText('Alpha dataset')).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toContain('/insights?focus=d1');
  });

  test('shows a stat caption derived from the chart data', () => {
    renderW({ reduced: true });
    expect(screen.getByText('b · 2')).toBeInTheDocument();
  });

  test('cycles to the next item after the interval', () => {
    vi.useFakeTimers();
    try {
      renderW({ reduced: false });
      expect(screen.getByText('Alpha dataset')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(5000 + 400 + 60); });
      expect(screen.getByText('Beta dataset')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('reduced motion holds on the first item (no cycling)', () => {
    vi.useFakeTimers();
    try {
      renderW({ reduced: true });
      act(() => { vi.advanceTimersByTime(20000); });
      expect(screen.getByText('Alpha dataset')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
