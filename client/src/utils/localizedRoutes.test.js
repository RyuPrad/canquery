import { describe, expect, test } from 'vitest';
import { oasPath, oasRoute, routeLanguage, translatedPath } from './localizedRoutes.js';

describe('pages with an address per language', () => {
  test('the OAS hub and its table pages have one address in each language', () => {
    expect(oasPath('en')).toBe('/oas');
    expect(oasPath('fr')).toBe('/fr/sv');
    expect(oasPath('en', 3)).toBe('/oas/table-3');
    expect(oasPath('fr', 3)).toBe('/fr/sv/tableau-3');
    expect(oasPath('de', 3)).toBe('/oas/table-3');
  });
  test('an address names its language and table', () => {
    expect(oasRoute('/oas')).toEqual({ language: 'en', table: null });
    expect(oasRoute('/oas/')).toEqual({ language: 'en', table: null });
    expect(oasRoute('/OAS/Table-2')).toEqual({ language: 'en', table: 2 });
    expect(oasRoute('/fr/sv')).toEqual({ language: 'fr', table: null });
    expect(oasRoute('/fr/sv/tableau-5/')).toEqual({ language: 'fr', table: 5 });
    for (const path of ['/oas/table-6', '/oas/tableau-1', '/fr/sv/table-1', '/oasis', '/fr/svp', '/datasets', '/', '', undefined, '/fr/blog/x']) {
      expect([path, oasRoute(path)]).toEqual([path, null]);
    }
    expect(routeLanguage('/fr/sv/tableau-1')).toBe('fr');
    expect(routeLanguage('/oas')).toBe('en');
    expect(routeLanguage('/datasets')).toBeNull();
  });
  test('the other language’s page is the same table', () => {
    expect(translatedPath('/oas', 'fr')).toBe('/fr/sv');
    expect(translatedPath('/oas/table-4', 'fr')).toBe('/fr/sv/tableau-4');
    expect(translatedPath('/fr/sv/tableau-4', 'en')).toBe('/oas/table-4');
    expect(translatedPath('/fr/sv', 'fr')).toBe('/fr/sv');
    expect(translatedPath('/datasets', 'fr')).toBeNull();
    expect(translatedPath('/fr/blog/guide', 'en')).toBeNull();
  });
});
