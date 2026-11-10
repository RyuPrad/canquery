import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../extensions.js');
  vi.resetModules();
});

async function load(part) {
  vi.resetModules();
  vi.doMock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => part || fallback }));
  return (await import('./WatchTableSlot.jsx')).default;
}

test('the community edition shows nothing', async () => {
  const WatchTableSlot = await load(null);
  const { container } = render(<WatchTableSlot resourceId="a" q="king" filters={{}} total={3} />);
  expect(container).toBeEmptyDOMElement();
});

test('the hosted part gets the table, its search and how many rows match', async () => {
  const WatchTable = vi.fn(({ resourceId, q, filters, total }) => <p>{[resourceId, q, JSON.stringify(filters), total].join('|')}</p>);
  const WatchTableSlot = await load({ WatchTable });
  render(<WatchTableSlot resourceId="a" q="king" filters={{ status: { op: 'eq', value: 'Issued' } }} total={12} />);
  expect(screen.getByText('a|king|{"status":{"op":"eq","value":"Issued"}}|12')).toBeInTheDocument();
});

test('nothing without a resource', async () => {
  const WatchTable = vi.fn(() => <p>watch</p>);
  const WatchTableSlot = await load({ WatchTable });
  const { container } = render(<><WatchTableSlot resourceId="" q="king" /><WatchTableSlot /></>);
  expect(container).toBeEmptyDOMElement();
  expect(WatchTable).not.toHaveBeenCalled();
});
