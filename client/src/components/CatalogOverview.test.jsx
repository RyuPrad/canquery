import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CatalogOverview from './CatalogOverview.jsx';
import { STRINGS } from '../i18n.jsx';

vi.mock('../i18n.jsx', async importOriginal => {
  const original = await importOriginal();
  return { ...original, useLang: () => ({ lang: 'fr', t: key => original.STRINGS.fr[key] }) };
});

describe('catalogue overview', () => {
  it('shows recorded schema and file language with localized interface and no form actions', () => {
    const { container } = render(<CatalogOverview presentation={{
      summary: { fr: 'Explorez les données.' }, formats: ['XLSX'], languages: ['en'],
      capabilities: { table: 'ready', map: true, download: true },
      fields: { items: [{ name: 'Province', type: 'TEXT' }], total: 25, source: 'table' }
    }} />);
    expect(screen.getByText('Anglais')).toBeInTheDocument();
    expect(screen.getByText('Province')).toBeInTheDocument();
    expect(screen.getByText(/1\/25/)).toBeInTheDocument();
    expect(screen.getByText(STRINGS.fr['preview.title'])).toBeInTheDocument();
    expect(container.querySelector('button, input, form')).toBeNull();
  });

  it('omits missing metadata instead of displaying invented fields or languages', () => {
    render(<CatalogOverview presentation={{ summary: { fr: 'Un fichier.' }, formats: [], languages: [],
      capabilities: {}, fields: { items: [], total: 0 } }} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(STRINGS.fr['preview.languages'])).not.toBeInTheDocument();
  });
});
