import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import TopDownloadRow from './TopDownloadRow.jsx';

const item = { rank: 7, dataset_id: 'd7', dataset_name: 'federal-corporations', title: { en: 'Federal Corporations' },
  department: 'ISED', downloads: 1234, history: [{ y: 2026, m: 4, d: 900 }, { y: 2026, m: 5, d: 1234 }], resource_id: 'r7' };

test('links the row to the canonical dataset slug with the charted resource highlighted', () => {
  render(<MemoryRouter><TopDownloadRow item={item} /></MemoryRouter>);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/datasets/federal-corporations?highlight=r7');
  expect(screen.getByText('Federal Corporations')).toBeInTheDocument();
});

test('falls back to the dataset id when no slug is known and omits the highlight for download-only datasets', () => {
  render(<MemoryRouter><TopDownloadRow item={{ ...item, dataset_name: null, resource_id: null }} /></MemoryRouter>);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/datasets/d7');
});
