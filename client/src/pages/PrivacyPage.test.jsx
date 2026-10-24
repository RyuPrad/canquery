import { render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { LangProvider } from '../i18n.jsx';
import PrivacyPage from './PrivacyPage.jsx';

// Core page without any extension; src/enterprise/privacy.test.jsx covers accounts.
vi.mock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => fallback }));

afterEach(() => {
  localStorage.clear();
  document.head.querySelector('meta[name="google-adsense-account"]')?.remove();
});

// The server adds this meta to every page when the deployment runs Google AdSense.
function markAdsOn() {
  const meta = document.createElement('meta');
  meta.name = 'google-adsense-account';
  meta.content = 'ca-pub-9765393503852455';
  document.head.append(meta);
}

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
  expect(screen.queryByText(/Optional developer accounts/)).toBeNull();
  expect(screen.getByText(/Encrypted recovery copies/)).not.toHaveTextContent('account and usage records');
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
  expect(screen.queryByText(/Les comptes facultatifs/)).toBeNull();
});

test('discloses Google advertising only when the deployment runs it', () => {
  const { unmount } = render(<PrivacyPage />);
  expect(screen.queryByRole('heading', { name: 'Advertising' })).toBeNull();
  unmount();

  markAdsOn();
  render(<PrivacyPage />);
  expect(screen.getByRole('heading', { level: 2, name: 'Advertising' })).toBeInTheDocument();
  expect(screen.getByText(/Third-party vendors, including Google, use cookies to serve ads/)).toHaveTextContent(
    'Do Not Track and Global Privacy Control turn off CanQuery’s analytics but not Google’s ad code. Account and sign-in pages carry no ads.');
  expect(screen.getByRole('link', { name: 'Google Ads Settings' })).toHaveAttribute('href', 'https://www.google.com/settings/ads');
  expect(screen.getByRole('link', { name: 'www.aboutads.info' })).toHaveAttribute('href', 'https://www.aboutads.info/choices/');
});

test('discloses Google advertising in French', () => {
  localStorage.setItem('cq-lang', 'fr');
  markAdsOn();
  render(<LangProvider><PrivacyPage /></LangProvider>);
  expect(screen.getByRole('heading', { level: 2, name: 'Publicité' })).toBeInTheDocument();
  expect(screen.getByText(/Des fournisseurs tiers, dont Google, utilisent des témoins/)).toHaveTextContent(
    'mais pas le code publicitaire de Google');
  expect(screen.getByRole('link', { name: 'Paramètres des annonces Google' })).toHaveAttribute('href', 'https://www.google.com/settings/ads');
});
