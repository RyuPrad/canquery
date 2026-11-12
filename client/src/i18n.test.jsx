import { afterEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LangProvider, STRINGS, useLang } from './i18n.jsx';

describe('interface translation dictionary', () => {
  test('keeps English and French keys in exact parity', () => {
    expect(Object.keys(STRINGS.fr).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });
});

describe('the language a visit starts in', () => {
  function Language() {
    return <p data-testid="language">{useLang().lang}</p>;
  }
  const startAt = (path) => {
    window.history.replaceState(null, '', path);
    const view = render(<LangProvider><Language /></LangProvider>);
    const language = screen.getByTestId('language').textContent;
    view.unmount();
    return language;
  };
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
  });

  test('is the address’s on a page with an address per language, whatever was stored', () => {
    localStorage.setItem('cq-lang', 'en');
    expect(startAt('/fr/sv')).toBe('fr');
    expect(startAt('/fr/sv/tableau-3')).toBe('fr');
    expect(startAt('/fr/blog/un-guide')).toBe('fr');
    localStorage.setItem('cq-lang', 'fr');
    expect(startAt('/oas')).toBe('en');
    expect(startAt('/oas/table-1')).toBe('en');
    expect(startAt('/blog')).toBe('en');
  });

  test('is the stored one everywhere else, English by default', () => {
    expect(startAt('/datasets')).toBe('en');
    localStorage.setItem('cq-lang', 'fr');
    expect(startAt('/datasets')).toBe('fr');
    expect(startAt('/oas/table-9')).toBe('fr');
  });
});
