import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../extensions.js');
  vi.resetModules();
});

async function load(part) {
  vi.resetModules();
  vi.doMock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => part || fallback }));
  return (await import('./QueryGateSlot.jsx')).default;
}

test('the community edition shows nothing', async () => {
  const QueryGateSlot = await load(null);
  const { container } = render(<QueryGateSlot resourceId="a" datasetId="d" />);
  expect(container).toBeEmptyDOMElement();
});

test('the hosted part gets the resource and its dataset', async () => {
  const QueryWall = vi.fn(({ resourceId, datasetId }) => <p>{resourceId + '|' + datasetId}</p>);
  const QueryGateSlot = await load({ QueryWall });
  render(<QueryGateSlot resourceId="a" datasetId="d" />);
  expect(screen.getByText('a|d')).toBeInTheDocument();
});

test('nothing without a resource', async () => {
  const QueryWall = vi.fn(() => <p>wall</p>);
  const QueryGateSlot = await load({ QueryWall });
  const { container } = render(<><QueryGateSlot resourceId="" datasetId="d" /><QueryGateSlot /></>);
  expect(container).toBeEmptyDOMElement();
  expect(QueryWall).not.toHaveBeenCalled();
});
