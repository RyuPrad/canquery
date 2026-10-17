import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../extensions.js');
  vi.resetModules();
});

async function loadSlot(part) {
  vi.resetModules();
  vi.doMock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => part || fallback }));
  return (await import('./DatasetAlertSlot.jsx')).default;
}

test('renders nothing in the community edition', async () => {
  const DatasetAlertSlot = await loadSlot(null);
  const { container } = render(<DatasetAlertSlot datasetId="d1" variant="dataset" />);
  expect(container).toBeEmptyDOMElement();
});

test('passes the dataset to the hosted part', async () => {
  const DatasetAlert = vi.fn(({ datasetId, datasetTitle, variant }) => <p>{[datasetId, datasetTitle, variant].join('|')}</p>);
  const DatasetAlertSlot = await loadSlot({ DatasetAlert });
  render(<DatasetAlertSlot datasetId="d1" datasetTitle="Building permits" variant="resource" />);
  expect(screen.getByText('d1|Building permits|resource')).toBeInTheDocument();
});

test('renders nothing without a dataset id', async () => {
  const DatasetAlert = vi.fn(() => <p>alert</p>);
  const DatasetAlertSlot = await loadSlot({ DatasetAlert });
  const { container } = render(<DatasetAlertSlot datasetId="" variant="guide" />);
  expect(container).toBeEmptyDOMElement();
  expect(DatasetAlert).not.toHaveBeenCalled();
});
