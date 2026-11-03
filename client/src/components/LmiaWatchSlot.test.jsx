import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { LangProvider } from '../i18n.jsx';

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

test('the LMIA dataset and its files link to the employer search; other datasets do not', async () => {
  const { default: LmiaHubLink } = await import('./LmiaHubLink.jsx');
  const { container, rerender } = render(
    <LangProvider><MemoryRouter><LmiaHubLink datasetId="90fed587-1364-4f33-a9ee-208181dc0b97" /></MemoryRouter></LangProvider>);
  expect(screen.getByRole('link', { name: 'Search positive LMIA employers' })).toHaveAttribute('href', '/lmia');
  rerender(<LangProvider><MemoryRouter><LmiaHubLink datasetId="something-else" /></MemoryRouter></LangProvider>);
  expect(container).toBeEmptyDOMElement();
});
