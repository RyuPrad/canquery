import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import PlaceSelect from './PlaceSelect.jsx';

describe('PlaceSelect', () => {
  test('keeps All Canada explicit and returns stable place slugs', () => {
    const onChange = vi.fn();
    const { container } = render(<PlaceSelect value="" onChange={onChange} places={[
      { id: 'ca-on', slug: 'ontario', kind: 'province', name: { en: 'Ontario' }, dataset_count: 5 },
      { id: 'ca-on-durham', slug: 'durham-on', kind: 'region', name: { en: 'Durham' }, dataset_count: 12 },
      { id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality', name: { en: 'Oshawa' }, parent: { id: 'ca-on-durham' }, dataset_count: 10 },
      { id: 'sgc-cd-3521', slug: 'peel-on', kind: 'region', name: { en: 'Peel' }, dataset_count: 901 },
      { id: 'sgc-csd-3521005', slug: 'mississauga-on', kind: 'municipality', name: { en: 'Mississauga' }, parent: { id: 'sgc-cd-3521' }, dataset_count: 429 },
      { id: 'sgc-cd-3506', slug: 'ottawa-on', kind: 'municipality', name: { en: 'Ottawa' }, parent: { id: 'ca-on' }, dataset_count: 392 },
      { id: 'sgc-cd-3520', slug: 'toronto-on', kind: 'municipality', name: { en: 'Toronto' }, parent: { id: 'ca-on' }, dataset_count: 556 },
    ]} />);
    const select = screen.getByRole('combobox', { name: 'Choose a place' });
    expect(select).toHaveDisplayValue('All Canada');
    fireEvent.change(select, { target: { value: 'oshawa-on' } });
    expect(onChange).toHaveBeenCalledWith('oshawa-on');
    expect(screen.getByRole('option', { name: /Ottawa/ })).toBeInTheDocument();
    expect([...container.querySelectorAll('optgroup')].map(group => group.label)).toEqual([
      'Featured regions', 'Municipalities in Durham', 'Municipalities in Peel', 'Featured cities', 'Other places'
    ]);
  });
});
