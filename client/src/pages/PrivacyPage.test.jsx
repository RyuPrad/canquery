import { render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { LangProvider } from '../i18n.jsx';
import PrivacyPage from './PrivacyPage.jsx';

afterEach(() => localStorage.clear());

test('discloses analytics collection and browser opt-outs in English', () => {
  render(<PrivacyPage />);
  expect(screen.getByRole('heading', { level: 1, name: 'Privacy and analytics' })).toBeInTheDocument();
  expect(screen.getByText(/exact text of completed searches/i)).toBeInTheDocument();
  expect(screen.getByText(/No session replay/i)).toBeInTheDocument();
  expect(screen.getByText(/Global Privacy Control/i)).toBeInTheDocument();
  expect(screen.getByText(/kept indefinitely/i)).toBeInTheDocument();
});

test('renders the full disclosure in French', () => {
  localStorage.setItem('cq-lang', 'fr');
  render(<LangProvider><PrivacyPage /></LangProvider>);
  expect(screen.getByRole('heading', { level: 1, name: 'Confidentialité et analytique' })).toBeInTheDocument();
  expect(screen.getByText(/texte exact des recherches/i)).toBeInTheDocument();
  expect(screen.getByText(/conservées indéfiniment/i)).toBeInTheDocument();
});
