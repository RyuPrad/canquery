// The hosted privacy page explains how developer accounts handle personal information.
import { render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { LangProvider } from '../i18n.jsx';
import PrivacyPage from '../pages/PrivacyPage.jsx';

afterEach(() => localStorage.clear());

test('describes developer accounts and their backups in English', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/Optional developer accounts/)).toHaveTextContent('Account and password pages do not load analytics');
  expect(screen.getByText(/Encrypted recovery copies/)).toHaveTextContent('account and usage records');
});

test('describes developer accounts in French', () => {
  localStorage.setItem('cq-lang', 'fr');
  render(<LangProvider><PrivacyPage /></LangProvider>);
  expect(screen.getByText(/Les comptes facultatifs/)).toHaveTextContent('Les pages de compte et de mot de passe ne chargent pas l’analytique');
});
