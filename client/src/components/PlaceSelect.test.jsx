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
      { id: 'sgc-cd-3520', slug: 'toronto-on', kind: 'municipality', name: { en: 'Toronto' }, parent: { id: 'ca-on' }, dataset_count: 556 },
    ]} />);
    const select = screen.getByRole('combobox', { name: 'Choose a place' });
    expect(select).toHaveDisplayValue('All Canada');
    fireEvent.change(select, { target: { value: 'oshawa-on' } });
    expect(onChange).toHaveBeenCalledWith('oshawa-on');
    expect([...container.querySelectorAll('optgroup')].map(group => group.label)).toEqual([
      'Featured regions', 'Municipalities in Durham', 'Featured cities', 'Other places'
    ]);
  });
});
