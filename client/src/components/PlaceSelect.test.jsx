import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import PlaceSelect from './PlaceSelect.jsx';

describe('PlaceSelect', () => {
  test('keeps All Canada explicit and returns stable place slugs', () => {
    const onChange = vi.fn();
    render(<PlaceSelect value="" onChange={onChange} places={[
      { id: 'ca-on', slug: 'ontario', kind: 'province', name: { en: 'Ontario' }, dataset_count: 5 },
      { id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality', name: { en: 'Oshawa' }, dataset_count: 10 },
    ]} />);
    const select = screen.getByRole('combobox', { name: 'Choose a place' });
    expect(select).toHaveDisplayValue('All Canada');
    fireEvent.change(select, { target: { value: 'oshawa-on' } });
    expect(onChange).toHaveBeenCalledWith('oshawa-on');
  });
});
