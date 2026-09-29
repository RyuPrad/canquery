import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import InsightCard from './InsightCard.jsx';
import { fetchResourceProfile } from '../api/catalog.js';

vi.mock('../api/catalog.js', () => ({ fetchResourceProfile: vi.fn() }));
vi.mock('./charts/InsightChart.jsx', () => ({ default: ({ resourceId }) => <div>Chart for {resourceId}</div> }));
const profile = { data: { row_count: 10, columns: [{ id: 'status', type: 'TEXT', distinct: 2, nulls: 0 }] } };
const card = id => <MemoryRouter><InsightCard item={{ resource_id: id, name: { en: 'Dataset' } }} /></MemoryRouter>;

beforeEach(() => { vi.clearAllMocks(); });

test('a replacement representative resource never displays the previous profile', async () => {
  fetchResourceProfile.mockResolvedValueOnce(profile).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(card('english'));
  expect(await screen.findByText('Chart for english')).toBeInTheDocument();
  view.rerender(card('french'));
  expect(screen.queryByText('Chart for french')).not.toBeInTheDocument();
});

test('a previous profile error does not hide a successfully loaded replacement', async () => {
  fetchResourceProfile.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(profile);
  const view = render(card('english'));
  expect(await screen.findByText("Couldn't load insights for this table.")).toBeInTheDocument();
  view.rerender(card('french'));
  await act(async () => {});
  expect(await screen.findByText('Chart for french')).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load insights for this table.")).not.toBeInTheDocument();
});
