// Hosted FAQ additions: the account question, plan and credit answers, and
// links to pricing and terms.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test } from 'vitest';
import { LangProvider } from '../i18n.jsx';
import FaqPage from '../pages/FaqPage.jsx';

afterEach(() => localStorage.clear());

test.each(['en', 'fr'])('FAQ adds account, plan and credit answers with their links (%s)', lang => {
  localStorage.setItem('cq-lang', lang);
  const { container } = render(<MemoryRouter><LangProvider><FaqPage /></LangProvider></MemoryRouter>);
  expect(container.querySelectorAll('details')).toHaveLength(11);
  expect(container.querySelectorAll('#getting-started + .cq-faq-list summary')[1]).toHaveTextContent(lang === 'en' ? 'Do I need an account?' : 'Ai-je besoin d’un compte?');
  expect(screen.getByRole('heading', { level: 2, name: lang === 'en' ? 'Accounts and the API' : 'Comptes et API' })).toBeInTheDocument();
  expect(screen.getByText(lang === 'en' ? /A return to an expired period/ : /Un retour à une période expirée/)).toHaveTextContent(lang === 'en' ? 'not cash refunds' : 'pas d’un remboursement monétaire');
  expect(screen.getByText(/X-Request-Id/)).toHaveTextContent(lang === 'en' ? 'Leave out API keys, passwords' : 'N’incluez ni clé API, ni mot de passe');
  expect(container.querySelector('a[href="/pricing"]')).not.toBeNull();
  expect(container.querySelector('a[href="/terms"]')).not.toBeNull();
});
