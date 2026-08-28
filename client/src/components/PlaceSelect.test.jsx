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
      { id: 'sgc-csd-2466023', slug: 'montreal-qc', kind: 'municipality', name: { en: 'Montréal' }, parent: { id: 'sgc-cd-2466' }, dataset_count: 405 },
      { id: 'sgc-csd-2423027', slug: 'quebec-qc', kind: 'municipality', name: { en: 'Québec' }, parent: { id: 'sgc-cd-2423' }, dataset_count: 35 },
      { id: 'sgc-cd-2465', slug: 'laval-qc', kind: 'municipality', name: { en: 'Laval' }, parent: { id: 'sgc-pr-24' }, dataset_count: 130 },
      { id: 'sgc-csd-5915022', slug: 'vancouver-bc', kind: 'municipality', name: { en: 'Vancouver' }, parent: { id: 'sgc-cd-5915' }, dataset_count: 178 },
      { id: 'sgc-csd-4806016', slug: 'calgary-ab', kind: 'municipality', name: { en: 'Calgary' }, parent: { id: 'sgc-cd-4806' }, dataset_count: 570 },
      { id: 'sgc-csd-4811061', slug: 'edmonton-ab', kind: 'municipality', name: { en: 'Edmonton' }, parent: { id: 'sgc-cd-4811' }, dataset_count: 974 },
      { id: 'sgc-csd-4611040', slug: 'winnipeg-mb', kind: 'municipality', name: { en: 'Winnipeg' }, parent: { id: 'sgc-cd-4611' }, dataset_count: 229 },
      { id: 'sgc-csd-1209034', slug: 'halifax-ns', kind: 'municipality', name: { en: 'Halifax' }, parent: { id: 'sgc-cd-1209' }, dataset_count: 327 },
      { id: 'sgc-cd-3525', slug: 'hamilton-on', kind: 'municipality', name: { en: 'Hamilton' }, parent: { id: 'ca-on' }, dataset_count: 376 },
      { id: 'sgc-csd-5915004', slug: 'surrey-bc', kind: 'municipality', name: { en: 'Surrey' }, parent: { id: 'sgc-cd-5915' }, dataset_count: 216 },
    ]} />);
    const select = screen.getByRole('combobox', { name: 'Choose a place' });
    expect(select).toHaveDisplayValue('All Canada');
    fireEvent.change(select, { target: { value: 'oshawa-on' } });
    expect(onChange).toHaveBeenCalledWith('oshawa-on');
    expect(screen.getByRole('option', { name: /Ottawa/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Montréal/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: /Vancouver/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Québec/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Laval/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Calgary/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Edmonton/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Winnipeg/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Halifax/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Hamilton/ })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /Surrey/ })).toHaveLength(1);
    expect([...container.querySelectorAll('optgroup')].map(group => group.label)).toEqual([
      'Featured regions', 'Municipalities in Durham', 'Municipalities in Peel', 'Featured cities', 'Other places'
    ]);
  });
});
