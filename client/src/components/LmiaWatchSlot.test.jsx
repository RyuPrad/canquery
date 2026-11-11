import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../extensions.js');
  vi.resetModules();
});

async function loadSlot(part) {
  vi.resetModules();
  vi.doMock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => part || fallback }));
  return (await import('./LmiaWatchSlot.jsx')).default;
}

test('renders nothing in the community edition', async () => {
  const LmiaWatchSlot = await loadSlot(null);
  const { container } = render(<LmiaWatchSlot employer="Danchar Ltd" employerKey="danchar" province="ON" placement="search" />);
  expect(container).toBeEmptyDOMElement();
});

test('passes the employer to the hosted part', async () => {
  const LmiaWatch = vi.fn(({ employer, employerKey, province, placement }) => <p>{[employer, employerKey, province, placement].join('|')}</p>);
  const LmiaWatchSlot = await loadSlot({ LmiaWatch });
  render(<LmiaWatchSlot employer="Danchar Ltd" employerKey="danchar" province="ON" placement="employer" />);
  expect(screen.getByText('Danchar Ltd|danchar|ON|employer')).toBeInTheDocument();
});

test('renders nothing without an employer', async () => {
  const LmiaWatch = vi.fn(() => <p>watch</p>);
  const LmiaWatchSlot = await loadSlot({ LmiaWatch });
  const { container } = render(<LmiaWatchSlot employer="" employerKey="danchar" />);
  expect(container).toBeEmptyDOMElement();
  expect(LmiaWatch).not.toHaveBeenCalled();
});
