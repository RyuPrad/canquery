import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResourceBadge from './ResourceBadge.jsx';
import DatasetRow from './DatasetRow.jsx';

describe('badges and rows', () => {
  test('ResourceBadge maps modes to labels', () => {
    render(<ResourceBadge mode="datastore" />);
    expect(screen.getByText('Queryable')).toBeInTheDocument();

    render(<ResourceBadge mode="ingested" />);
    expect(screen.getByText('Unlocked')).toBeInTheDocument();

    render(<ResourceBadge mode="ingestable" />);
    expect(screen.getByText('Ingestable')).toBeInTheDocument();

    render(<ResourceBadge mode="file-only" />);
    expect(screen.getByText('File only')).toBeInTheDocument();
  });

  test('DatasetRow shows the English title and the queryable badge', () => {
    const dataset = {
      id: 'd1',
      name: 'd1',
      title: { en: 'Water quality', fr: null },
      organization: { name: 'eccc', title: { en: 'Environment Canada', fr: null } },
      metadata_modified: '2026-01-01T00:00:00Z',
      resource_count: 4,
      queryable_count: 2
    };
    render(
      <MemoryRouter>
        <DatasetRow dataset={dataset} />
      </MemoryRouter>
    );
    expect(screen.getByText('Water quality')).toBeInTheDocument();
    expect(screen.getByText('4 resources')).toBeInTheDocument();
    expect(screen.getByText('2 queryable')).toBeInTheDocument();
  });

  test('DatasetRow hides the queryable badge at zero', () => {
    const dataset = {
      id: 'd1',
      name: 'd1',
      title: { en: 'Water quality', fr: null },
      organization: { name: 'eccc', title: { en: 'Environment Canada', fr: null } },
      metadata_modified: '2026-01-01T00:00:00Z',
      resource_count: 4,
      queryable_count: 0
    };
    render(
      <MemoryRouter>
        <DatasetRow dataset={dataset} />
      </MemoryRouter>
    );
    expect(screen.queryByText('0 queryable')).toBeNull();
  });
});
