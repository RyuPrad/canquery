import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../extensions.js');
  vi.resetModules();
});

async function load(part) {
  vi.resetModules();
  vi.doMock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => part || fallback }));
  return {
    FollowSlot: (await import('./FollowSlot.jsx')).default,
    SaveSearchSlot: (await import('./SaveSearchSlot.jsx')).default
  };
}
const search = { q: 'permits', org: [], format: [], keyword: [], source: [], level: [], place: '', mappable: false, queryable: false, sort: 'relevance' };

test('the community edition shows neither', async () => {
  const { FollowSlot, SaveSearchSlot } = await load(null);
  const { container } = render(<><FollowSlot kind="place" target="ottawa" title="Ottawa" /><SaveSearchSlot search={search} total={3} /></>);
  expect(container).toBeEmptyDOMElement();
});

test('the hosted parts get the place, publisher or search', async () => {
  const Follow = vi.fn(({ kind, target, title }) => <p>{[kind, target, title].join('|')}</p>);
  const SaveSearch = vi.fn(({ search: saved, total }) => <p>{saved.q + '|' + total}</p>);
  const { FollowSlot, SaveSearchSlot } = await load({ Follow, SaveSearch });
  render(<><FollowSlot kind="organization" target="statcan" title="Statistics Canada" /><SaveSearchSlot search={search} total={3} /></>);
  expect(screen.getByText('organization|statcan|Statistics Canada')).toBeInTheDocument();
  expect(screen.getByText('permits|3')).toBeInTheDocument();
});

test('nothing without a target, or for a search with no criteria', async () => {
  const Follow = vi.fn(() => <p>follow</p>);
  const SaveSearch = vi.fn(() => <p>save</p>);
  const { FollowSlot, SaveSearchSlot } = await load({ Follow, SaveSearch });
  const { container } = render(<>
    <FollowSlot kind="place" target="" title="Ottawa" />
    <FollowSlot kind="place" target="ottawa" title="" />
    <SaveSearchSlot search={{ ...search, q: '' }} total={64000} />
    <SaveSearchSlot total={3} />
  </>);
  expect(container).toBeEmptyDOMElement();
  expect(Follow).not.toHaveBeenCalled();
  expect(SaveSearch).not.toHaveBeenCalled();
});
