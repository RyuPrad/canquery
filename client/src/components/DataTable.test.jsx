import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import DataTable from './DataTable.jsx';

const fields = [{ id: '_id', type: 'INTEGER' }, { id: 'City name', type: 'TEXT' }];
const props = overrides => ({ fields, records: [{ _id: 1, 'City name': 'Ottawa' }], sort: null,
  onSortChange: vi.fn(), columnFilters: {}, onColumnFilterChange: vi.fn(), ...overrides });

describe('table keyboard controls', () => {
  test('sort headers expose a button and announce the current direction', () => {
    const input = props();
    const view = render(<DataTable {...input} />);
    const button = screen.getByRole('button', { name: /City name/ });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(input.onSortChange).toHaveBeenCalledWith('City name asc');
    view.rerender(<DataTable {...input} sort="City name asc" />);
    expect(screen.getByRole('columnheader', { name: /City name/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: /City name/ }));
    expect(input.onSortChange).toHaveBeenLastCalledWith('City name desc');
    view.rerender(<DataTable {...input} sort="City name desc" />);
    fireEvent.click(screen.getByRole('button', { name: /City name/ }));
    expect(input.onSortChange).toHaveBeenLastCalledWith(null);
  });

  test('filter fields identify their column and preserve null display', () => {
    const input = props({ records: [{ _id: 1, 'City name': null }] });
    render(<DataTable {...input} />);
    fireEvent.change(screen.getByRole('textbox', { name: /City name/ }), { target: { value: '=Ottawa' } });
    expect(input.onColumnFilterChange).toHaveBeenCalledWith('City name', '=Ottawa');
    expect(screen.getByText('∅')).toBeInTheDocument();
  });

  test('an exact field name ending in a direction wins over parsing a suffix', () => {
    const input = props({ fields: [{ id: 'City', type: 'TEXT' }, { id: 'City desc', type: 'TEXT' }], sort: 'City desc' });
    render(<DataTable {...input} />);
    expect(screen.getByRole('columnheader', { name: 'CityTEXT' })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'City descTEXT' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'City descTEXT' }));
    expect(input.onSortChange).toHaveBeenCalledWith('City desc desc');
  });
});
