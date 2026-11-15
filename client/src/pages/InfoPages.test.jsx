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
  const what = screen.getByRole('heading', { level: 2, name: lang === 'en' ? 'What is CanQuery?' : 'Qu’est-ce que CanQuery?' });
  expect(what.nextElementSibling).toHaveTextContent(lang === 'en'
    ? 'CanQuery is a free search engine for Canadian open data.' : 'CanQuery est un moteur de recherche gratuit pour les données ouvertes canadiennes.');
  expect(screen.getByText(/@RyuPrad/)).toHaveTextContent(lang === 'en' ? 'not affiliated with the Government of Canada' : 'sans affiliation avec le gouvernement du Canada');
  expect(screen.getByText(/@RyuPrad/)).toHaveTextContent(lang === 'en' ? 'software licence is separate' : 'licence du logiciel est distincte');
  expect(container.querySelector('a[href="https://github.com/RyuPrad/canquery"]')).not.toBeNull();
  expect(container.querySelector('a[href="/datasets"]')).not.toBeNull();
  expect(container.querySelector('a[href="/faq"]')).not.toBeNull();
  // Where the data comes from, how guides are checked, who runs the site and how to get something corrected.
  const section = name => screen.getByRole('heading', { level: 2, name }).closest('section');
  const en = lang === 'en';
  const sources = section(en ? 'Where the data comes from and how often it is refreshed' : 'D’où viennent les données et à quelle fréquence elles sont mises à jour');
  expect(sources).toHaveAttribute('id', 'data-sources');
  expect(sources.querySelectorAll('p')).toHaveLength(2);
  expect(sources).toHaveTextContent(en ? 'which also carries records from provincial and territorial governments'
    : 'qui diffuse aussi des fiches de gouvernements provinciaux et territoriaux');
  expect(sources).toHaveTextContent(en ? 'is listed only when it is published under a recognized open licence'
    : 'n’est répertoriée que si elle est publiée sous une licence ouverte reconnue');
  expect(sources).toHaveTextContent(en ? 'checked for changes every 30 minutes and read in full once a day'
    : 'consulté toutes les 30 minutes pour en relever les changements et relu en entier une fois par jour');
  expect(sources).toHaveTextContent(en ? 'is read from that portal when you open it, and answers are kept for up to five minutes'
    : 'est lue auprès de ce portail au moment où vous l’ouvrez, et les réponses sont conservées jusqu’à cinq minutes');
  expect(sources).toHaveTextContent(en ? 'the table says when the copy was made' : 'la table indique quand la copie a été faite');
  const guides = section(en ? 'How guides are written and checked' : 'Comment les guides sont rédigés et vérifiés');
  expect(guides).toHaveAttribute('id', 'guides');
  expect(guides).toHaveTextContent(en ? 'checked against the official source' : 'vérifiés auprès de la source officielle');
  expect(guides).toHaveTextContent(en ? 'Every guide shows three dates' : 'Chaque guide affiche trois dates');
  expect(guides).toHaveTextContent(en ? 'the guide is updated or withdrawn' : 'ne permet plus d’accomplir la tâche décrite, le guide est mis à jour ou retiré');
  expect(guides.querySelector('a')).toHaveAttribute('href', en ? '/blog' : '/fr/blog');
  expect(section(en ? 'Who runs CanQuery' : 'Qui est derrière CanQuery')).toHaveAttribute('id', 'who');
  const corrections = section('Corrections');
  expect(corrections).toHaveAttribute('id', 'corrections');
  expect(corrections.querySelector('a[href="mailto:support@canquery.com"]')).not.toBeNull();
  expect(corrections).toHaveTextContent(en ? 'can only be corrected by its publisher' : 'ne peut être corrigée que par leur éditeur');
  for (const link of screen.getAllByRole('link', { name: 'support@canquery.com' })) expect(link).toHaveAttribute('href', 'mailto:support@canquery.com');
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
