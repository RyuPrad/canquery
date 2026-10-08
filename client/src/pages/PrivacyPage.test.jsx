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
  expect(screen.getByText('No raw network addresses stored in product analytics.')).toBeInTheDocument();
  expect(screen.getByText(/hosting provider and Cloudflare process request information/)).toHaveTextContent('Browser analytics opt-outs do not prevent this necessary request processing');
  expect(screen.getByText(/Encrypted recovery copies/)).toHaveTextContent('Data removed from the live service may remain in a retained backup');
  expect(screen.getByText(/Optional developer accounts/)).toHaveTextContent('Account and password pages do not load analytics');
});

test('renders the full disclosure in French', () => {
  localStorage.setItem('cq-lang', 'fr');
  render(<LangProvider><PrivacyPage /></LangProvider>);
  expect(screen.getByRole('heading', { level: 1, name: 'Confidentialité et analytique' })).toBeInTheDocument();
  expect(screen.getByText(/texte exact des recherches/i)).toBeInTheDocument();
  expect(screen.getByText(/conservées indéfiniment/i)).toBeInTheDocument();
  expect(screen.getByText('Aucune adresse réseau brute conservée dans l’analytique produit.')).toBeInTheDocument();
  expect(screen.getByText(/L’hébergeur de CanQuery et Cloudflare/)).toHaveTextContent('Le refus de l’analytique dans le navigateur n’empêche pas ce traitement nécessaire');
  expect(screen.getByText(/Des copies de récupération chiffrées/)).toHaveTextContent('Les données supprimées du service actif peuvent subsister');
  expect(screen.getByText(/Les comptes facultatifs/)).toHaveTextContent('Les pages de compte et de mot de passe ne chargent pas l’analytique');
});
