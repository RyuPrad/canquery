import { describe, expect, test } from 'vitest';
import { cataloguePath, dayLabel, filterPortals, formatCount, localName, sortPortals, PORTALS_TIME_ZONE } from './portals.js';

const portal = (id, fields = {}) => ({
  id, platform: 'arcgis-hub', name: { en: id, fr: id }, homepage_url: 'https://example.test/' + id, level: 'municipal',
  place: null, province: null, datasets: 0, tables: 0, maps: 0, licence: null, last_synced_at: null, ...fields
});
const ONTARIO = { slug: 'ontario', name: { en: 'Ontario', fr: 'Ontario' } };
const QUEBEC = { slug: 'quebec', name: { en: 'Quebec', fr: 'Québec' } };
// In the directory's own order: most datasets first.
const PORTALS = [
  portal('open-canada', { platform: 'ckan', level: 'federal', name: { en: 'Government of Canada Open Data', fr: 'Données ouvertes du gouvernement du Canada' },
    datasets: 48310, tables: 2104, maps: 310, last_synced_at: '2026-11-15T21:30:04.000Z' }),
  portal('toronto', { platform: 'ckan', name: { en: 'City of Toronto Open Data', fr: 'Données ouvertes de la Ville de Toronto' },
    place: { slug: 'toronto-on', name: { en: 'Toronto', fr: 'Toronto' } }, province: ONTARIO, datasets: 556, tables: 324, maps: 157,
    last_synced_at: '2026-11-15T06:30:06.949Z' }),
  portal('ottawa', { name: { en: 'City of Ottawa Open Data', fr: 'Données ouvertes de la Ville d’Ottawa' },
    place: { slug: 'ottawa-on', name: { en: 'Ottawa', fr: 'Ottawa' } }, province: ONTARIO, datasets: 408, maps: 390,
    last_synced_at: '2026-11-15T06:31:39.000Z' }),
  portal('montreal', { platform: 'ckan', name: { en: 'Montréal Open Data', fr: 'Données ouvertes de la Ville de Montréal' },
    place: { slug: 'montreal-qc', name: { en: 'Montréal', fr: 'Montréal' } }, province: QUEBEC, datasets: 397, tables: 280, maps: 157 }),
  portal('nwt', { platform: 'ckan', level: 'provincial', name: { en: 'Northwest Territories Open Data', fr: 'Northwest Territories Open Data' },
    place: { slug: 'northwest-territories', name: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' } },
    province: { slug: 'northwest-territories', name: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' } }, datasets: 340, maps: 6,
    last_synced_at: '2026-11-14T07:09:25.000Z' }),
  portal('red-deer', { platform: 'other', name: { en: 'City of Red Deer Open Data', fr: 'City of Red Deer Open Data' }, datasets: 12, tables: 3,
    last_synced_at: 'not a date' })
];
const ids = (rows) => rows.map((row) => row.id);

describe('filtering the portal directory', () => {
  test('no filter keeps every portal in its order', () => {
    expect(ids(filterPortals(PORTALS, {}))).toEqual(ids(PORTALS));
    expect(ids(filterPortals(PORTALS))).toEqual(ids(PORTALS));
    expect(ids(filterPortals(PORTALS, { q: '   ' }))).toEqual(ids(PORTALS));
  });

  test('text matches the name in either language, the place and the province, without case or accents', () => {
    expect(ids(filterPortals(PORTALS, { q: 'toronto' }))).toEqual(['toronto']);
    expect(ids(filterPortals(PORTALS, { q: 'MONTREAL' }))).toEqual(['montreal']);
    expect(ids(filterPortals(PORTALS, { q: 'québec' }))).toEqual(['montreal']);
    expect(ids(filterPortals(PORTALS, { q: 'quebec' }))).toEqual(['montreal']);
    expect(ids(filterPortals(PORTALS, { q: 'ontario' }))).toEqual(['toronto', 'ottawa']);
    expect(ids(filterPortals(PORTALS, { q: 'territoires' }))).toEqual(['nwt']);
    expect(ids(filterPortals(PORTALS, { q: 'données ouvertes ville' }))).toEqual(['toronto', 'ottawa', 'montreal']);
    // Every word must be there.
    expect(ids(filterPortals(PORTALS, { q: 'city ottawa' }))).toEqual(['ottawa']);
    expect(ids(filterPortals(PORTALS, { q: 'city halifax' }))).toEqual([]);
  });

  test('level, platform and province each narrow the list, and together all must hold', () => {
    expect(ids(filterPortals(PORTALS, { level: 'federal' }))).toEqual(['open-canada']);
    expect(ids(filterPortals(PORTALS, { level: 'provincial' }))).toEqual(['nwt']);
    expect(ids(filterPortals(PORTALS, { platform: 'ckan' }))).toEqual(['open-canada', 'toronto', 'montreal', 'nwt']);
    expect(ids(filterPortals(PORTALS, { platform: 'other' }))).toEqual(['red-deer']);
    // A portal without a province is in no province.
    expect(ids(filterPortals(PORTALS, { province: 'ontario' }))).toEqual(['toronto', 'ottawa']);
    expect(ids(filterPortals(PORTALS, { province: 'ontario', platform: 'ckan' }))).toEqual(['toronto']);
    expect(ids(filterPortals(PORTALS, { province: 'ontario', platform: 'ckan', q: 'ottawa' }))).toEqual([]);
    expect(ids(filterPortals(PORTALS, { level: 'nowhere' }))).toEqual([]);
  });
});

describe('sorting the portal directory', () => {
  test('figures start with the largest and names with A; a second press turns the order around', () => {
    expect(ids(sortPortals(PORTALS))).toEqual(ids(PORTALS));
    expect(ids(sortPortals(PORTALS, { key: 'datasets', descending: false }))).toEqual([...ids(PORTALS)].reverse());
    expect(ids(sortPortals(PORTALS, { key: 'tables' }))).toEqual(['open-canada', 'toronto', 'montreal', 'red-deer', 'ottawa', 'nwt']);
    expect(ids(sortPortals(PORTALS, { key: 'name' }))).toEqual(['ottawa', 'red-deer', 'toronto', 'open-canada', 'montreal', 'nwt']);
    expect(ids(sortPortals(PORTALS, { key: 'name', descending: true }))).toEqual(['nwt', 'montreal', 'open-canada', 'toronto', 'red-deer', 'ottawa']);
  });

  test('names sort in the reader’s language, where an accent or a capital does not decide', () => {
    // In French the city portals start "Données ouvertes de la Ville": the city decides.
    expect(ids(sortPortals(PORTALS, { key: 'name' }, 'fr'))).toEqual(['red-deer', 'ottawa', 'montreal', 'toronto', 'open-canada', 'nwt']);
    const accents = [{ id: 'e', name: { en: 'Étude', fr: 'Étude' } }, { id: 'f', name: { en: 'fleuve', fr: 'fleuve' } },
      { id: 'd', name: { en: 'Eau', fr: 'Eau' } }];
    expect(ids(sortPortals(accents, { key: 'name' }, 'fr'))).toEqual(['d', 'e', 'f']);
  });

  test('ties keep the directory’s order in both directions', () => {
    // Maps: Toronto and Montréal both have 157.
    expect(ids(sortPortals(PORTALS, { key: 'maps' }))).toEqual(['ottawa', 'open-canada', 'toronto', 'montreal', 'nwt', 'red-deer']);
    expect(ids(sortPortals(PORTALS, { key: 'maps', descending: false }))).toEqual(['red-deer', 'nwt', 'toronto', 'montreal', 'open-canada', 'ottawa']);
  });

  test('a portal never read, or read at no date, comes after every date in both directions', () => {
    expect(ids(sortPortals(PORTALS, { key: 'read' }))).toEqual(['open-canada', 'ottawa', 'toronto', 'nwt', 'montreal', 'red-deer']);
    expect(ids(sortPortals(PORTALS, { key: 'read', descending: false }))).toEqual(['nwt', 'toronto', 'ottawa', 'open-canada', 'montreal', 'red-deer']);
  });

  test('the list given is not changed', () => {
    const before = ids(PORTALS);
    sortPortals(PORTALS, { key: 'name' });
    expect(ids(PORTALS)).toEqual(before);
  });
});

describe('what the portal directory prints', () => {
  test('counts and days follow the reader’s language', () => {
    expect(formatCount(48310, 'en')).toBe('48,310');
    expect(formatCount(48310, 'fr').replace(/\s/g, ' ')).toBe('48 310');
    expect(dayLabel('2026-11-15T21:30:04.000Z', 'en')).toBe('Nov 15, 2026');
    expect(dayLabel('2026-11-15T21:30:04.000Z', 'fr')).toBe('15 nov. 2026');
    // The day is the day in Eastern time, whatever the reader's clock: an evening read in Canada is not dated tomorrow.
    expect(dayLabel('2026-11-16T02:10:00.000Z', 'en')).toBe('Nov 15, 2026');
    expect(dayLabel('2026-11-16T04:59:59.000Z', 'fr')).toBe('15 nov. 2026');
    expect(dayLabel('2026-11-16T05:00:00.000Z', 'en')).toBe('Nov 16, 2026');
    // Daylight time: midnight is four hours behind UTC in July.
    expect(dayLabel('2026-07-01T03:59:59.000Z', 'en')).toBe('Jun 30, 2026');
    expect(dayLabel('2026-07-01T04:00:00.000Z', 'en')).toBe('Jul 1, 2026');
    expect(PORTALS_TIME_ZONE).toBe('America/Toronto');
    expect(dayLabel(null, 'en')).toBe('');
    expect(dayLabel('not a date', 'en')).toBe('');
  });

  test('a name is read in the reader’s language, falling back to the other', () => {
    expect(localName({ en: 'Quebec', fr: 'Québec' }, 'fr')).toBe('Québec');
    expect(localName({ en: 'Quebec', fr: 'Québec' }, 'en')).toBe('Quebec');
    expect(localName({ en: 'Only English', fr: null }, 'fr')).toBe('Only English');
    expect(localName({ en: null, fr: 'Seulement' }, 'en')).toBe('Seulement');
    expect(localName(null, 'en')).toBe('');
  });

  test('a count links to the portal’s datasets in the catalogue', () => {
    expect(cataloguePath('toronto-open-data')).toBe('/datasets?source=toronto-open-data');
    expect(cataloguePath('toronto-open-data', 'queryable')).toBe('/datasets?source=toronto-open-data&queryable=true');
    expect(cataloguePath('toronto-open-data', 'mappable')).toBe('/datasets?source=toronto-open-data&mappable=true');
    expect(cataloguePath('a b&c')).toBe('/datasets?source=a+b%26c');
  });
});
