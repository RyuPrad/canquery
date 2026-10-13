import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LangProvider, useLang } from '../i18n.jsx';
import AboutPage from './AboutPage.jsx';
import FaqPage from './FaqPage.jsx';

// Core pages without any extension; src/enterprise tests cover the hosted parts.
vi.mock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => fallback }));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Informational pages must not need API data'); }));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function LanguageSwitch() {
  const { setLang } = useLang();
  return <button onClick={() => setLang('fr')}>Switch to French</button>;
}

function renderPage(Page, lang) {
  localStorage.setItem('cq-lang', lang);
  return render(<MemoryRouter><LangProvider><Page /><LanguageSwitch /></LangProvider></MemoryRouter>);
}

test.each(['en', 'fr'])('FAQ offers readable answers and safe support without API data (%s)', lang => {
  const { container } = renderPage(FaqPage, lang);
  expect(screen.getByRole('heading', { level: 1, name: lang === 'en' ? 'Frequently asked questions' : 'Foire aux questions' })).toBeInTheDocument();
  const questions = [...container.querySelectorAll('details')];
  expect(questions).toHaveLength(6);
  for (const question of questions) {
    expect(question.firstElementChild.tagName).toBe('SUMMARY');
    expect(question.querySelector('p').textContent.length).toBeGreaterThan(30);
    expect(question).not.toHaveAttribute('open');
  }
  expect(screen.getByRole('link', { name: 'support@canquery.com' })).toHaveAttribute('href', 'mailto:support@canquery.com');
  expect(screen.getByText(/X-Request-Id/)).toHaveTextContent(lang === 'en' ? 'Leave out passwords' : 'N’incluez ni mot de passe');
  for (const path of ['/pricing', '/terms', '/account']) expect(container.querySelector(`a[href="${path}"]`)).toBeNull();
  expect(container.textContent).not.toMatch(lang === 'en' ? /account|credit|API key/i : /compte|crédit|clé API/i);
  expect(container.querySelector('a[href="/docs#preparation-example"]')).not.toBeNull();
  expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['en', 'fr'])('About preserves attribution and distinguishes software and data licences (%s)', lang => {
  const { container } = renderPage(AboutPage, lang);
  expect(screen.getByRole('heading', { level: 1, name: lang === 'en' ? 'About CanQuery' : 'À propos de CanQuery' })).toBeInTheDocument();
  expect(screen.getByText(/@RyuPrad/)).toHaveTextContent(lang === 'en' ? 'not affiliated with the Government of Canada' : 'sans affiliation avec le gouvernement du Canada');
  expect(screen.getByText(/@RyuPrad/)).toHaveTextContent(lang === 'en' ? 'software licence is separate' : 'licence du logiciel est distincte');
  expect(container.querySelector('a[href="https://github.com/RyuPrad/canquery"]')).not.toBeNull();
  expect(container.querySelector('a[href="/datasets"]')).not.toBeNull();
  expect(container.querySelector('a[href="/faq"]')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'support@canquery.com' })).toHaveAttribute('href', 'mailto:support@canquery.com');
  expect(fetch).not.toHaveBeenCalled();
});

test('switching language keeps an expanded answer open and translates its content', () => {
  const { container } = renderPage(FaqPage, 'en');
  const question = container.querySelector('details');
  question.open = true;
  fireEvent.click(screen.getByRole('button', { name: 'Switch to French' }));
  expect(question.open).toBe(true);
  expect(question.querySelector('summary')).toHaveTextContent('Que puis-je faire avec CanQuery?');
  expect(question.querySelector('p')).toHaveTextContent('Cherchez dans les catalogues');
  expect(screen.getByRole('heading', { level: 2, name: 'Contacter le soutien' })).toBeInTheDocument();
});
