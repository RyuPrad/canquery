import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import Sparkline from './Sparkline.jsx';

describe('Sparkline', () => {
  test('draws a polyline with one point per value', () => {
    const { container } = render(<Sparkline values={[1, 5, 3, 9]} />);
    const poly = container.querySelector('polyline');
    expect(poly).toBeTruthy();
    expect(poly.getAttribute('points').trim().split(' ')).toHaveLength(4);
  });

  test('renders a single dot (no line) for one point', () => {
    const { container } = render(<Sparkline values={[7]} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('circle')).toBeTruthy();
  });

  test('renders nothing chartable for empty or non-numeric values', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector('polyline')).toBeNull();
    const { container: c2 } = render(<Sparkline values={[null, undefined, NaN]} />);
    expect(c2.querySelector('polyline')).toBeNull();
  });
});
