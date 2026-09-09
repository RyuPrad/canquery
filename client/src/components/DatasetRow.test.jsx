import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import DatasetRow from './DatasetRow.jsx';

const dataset = { id: 'parks', name: 'parks', title: { en: 'Park boundaries' },
  description: { en: 'Explore published park boundaries.' }, resource_count: 1, queryable_count: 0, mappable_count: 1,
  preview_resources: { map: 'park-map', table: null } };

test('offers only supported resource actions and keeps links separate', () => {
  render(<MemoryRouter><DatasetRow dataset={dataset} /></MemoryRouter>);
  expect(screen.getByText(dataset.description.en)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Explore map' })).toHaveAttribute('href', '/resources/park-map?view=map');
  expect(screen.queryByRole('link', { name: 'View records' })).toBeNull();
  expect(document.querySelector('a a')).toBeNull();
  expect(screen.getByRole('link', { name: dataset.title.en })).toHaveAttribute('href', '/datasets/parks');
});
