import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import MiniChart from './MiniChart.jsx';

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
});
