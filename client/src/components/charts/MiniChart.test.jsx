import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import MiniChart from './MiniChart.jsx';
import { chartSummary } from './theme.js';

const pts = [{ label: 'A', value: 5 }, { label: 'B', value: 3 }, { label: 'C', value: 2 }];

describe('MiniChart', () => {
  test('donut renders an arc circle per slice', () => {
    const { container } = render(<MiniChart kind="donut" points={pts} animate={false} />);
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(3);
  });

  test('line renders a path', () => {
    const { container } = render(<MiniChart kind="line" points={pts} animate={false} />);
    expect(container.querySelector('path')).toBeTruthy();
  });

  test('bars renders one rect per point', () => {
    const { container } = render(<MiniChart kind="bars" points={pts} animate={false} />);
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });

  test('empty points render without crashing', () => {
    const { container } = render(<MiniChart kind="donut" points={[]} animate={false} />);
    expect(container.querySelector('circle')).toBeNull();
  });

  test('donut renders the center total when provided', () => {
    const { container } = render(<MiniChart kind="donut" points={pts} center="1,847" animate={false} />);
    const text = container.querySelector('text');
    expect(text && text.textContent).toBe('1,847');
  });
});

describe('chartSummary', () => {
  test('donut returns a center total and a top-share caption', () => {
    const s = chartSummary('donut', [{ label: 'Banks', value: 90 }, { label: 'Other', value: 10 }], 'en');
    expect(s.center).toBe('100');
    expect(s.caption).toBe('Banks · 90%');
  });

  test('line puts the latest value and period span in the caption', () => {
    const s = chartSummary('line', [{ label: '2015', value: 5 }, { label: '2024', value: 12 }], 'en');
    expect(s.caption).toBe('12 · 2015 – 2024');
  });
});
