// A portal directory as GET /web-api/v1/portals answers it, for tests.
const portal = (id, fields = {}) => ({
  id, platform: 'arcgis-hub', name: { en: id, fr: id }, homepage_url: 'https://example.test/' + id, level: 'municipal',
  place: null, province: null, datasets: 0, tables: 0, maps: 0, licence: null, last_synced_at: null, ...fields
});
const ONTARIO = { slug: 'ontario', name: { en: 'Ontario', fr: 'Ontario' } };
const QUEBEC = { slug: 'quebec', name: { en: 'Quebec', fr: 'Québec' } };
const NWT = { slug: 'northwest-territories', name: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' } };

export const PORTALS = [
  portal('open-canada', { platform: 'ckan', level: 'federal',
    name: { en: 'Government of Canada Open Data', fr: 'Données ouvertes du gouvernement du Canada' }, homepage_url: 'https://open.canada.ca/data/en/',
    datasets: 48310, tables: 2104, maps: 310, last_synced_at: '2026-11-15T21:30:04.000Z',
    licence: { title: { en: 'Open Government Licence – Canada', fr: 'Licence du gouvernement ouvert – Canada' },
      url: 'https://open.canada.ca/en/open-government-licence-canada' } }),
  portal('toronto-open-data', { platform: 'ckan', name: { en: 'City of Toronto Open Data', fr: 'Données ouvertes de la Ville de Toronto' },
    homepage_url: 'https://open.toronto.ca/', place: { slug: 'toronto-on', name: { en: 'Toronto', fr: 'Toronto' } }, province: ONTARIO,
    datasets: 556, tables: 324, maps: 157, last_synced_at: '2026-11-15T06:30:06.949Z',
    licence: { title: { en: 'Open Government Licence – Toronto', fr: 'Open Government Licence – Toronto' }, url: 'https://open.toronto.ca/open-data-license/' } }),
  portal('ottawa-hub', { name: { en: 'City of Ottawa Open Data', fr: 'Données ouvertes de la Ville d’Ottawa' }, homepage_url: 'https://open.ottawa.ca/',
    place: { slug: 'ottawa-on', name: { en: 'Ottawa', fr: 'Ottawa' } }, province: ONTARIO, datasets: 408, maps: 390,
    last_synced_at: '2026-11-15T06:31:39.000Z', licence: { title: { en: 'Open Government Licence – City of Ottawa', fr: 'Open Government Licence – City of Ottawa' }, url: null } }),
  portal('montreal-open-data', { platform: 'ckan', name: { en: 'Montréal Open Data', fr: 'Données ouvertes de la Ville de Montréal' },
    homepage_url: 'https://donnees.montreal.ca/', place: { slug: 'montreal-qc', name: { en: 'Montréal', fr: 'Montréal' } }, province: QUEBEC,
    datasets: 397, tables: 280, maps: 157, last_synced_at: '2026-11-15T06:30:12.991Z' }),
  portal('northwest-territories-open-data', { platform: 'ckan', level: 'provincial',
    name: { en: 'Northwest Territories Open Data', fr: 'Northwest Territories Open Data' }, homepage_url: 'https://opendata.gov.nt.ca/',
    place: NWT, province: NWT, datasets: 340, maps: 6, last_synced_at: '2026-11-14T07:09:25.000Z' }),
  portal('red-deer-hub', { platform: 'other', name: { en: 'City of Red Deer Open Data', fr: 'City of Red Deer Open Data' }, homepage_url: null,
    level: null, datasets: 12, tables: 3 })
];

export const DIRECTORY = {
  portals: PORTALS,
  totals: { portals: 6, datasets: 64485, provinces: 3 },
  platforms: [{ id: 'ckan', portals: 4, datasets: 49603 }, { id: 'arcgis-hub', portals: 1, datasets: 408 }, { id: 'other', portals: 1, datasets: 12 }],
  levels: [{ id: 'federal', portals: 1, datasets: 48310 }, { id: 'provincial', portals: 1, datasets: 340 }, { id: 'municipal', portals: 3, datasets: 1361 }],
  provinces: [{ id: 'northwest-territories', name: NWT.name, portals: 1, datasets: 340 }, { id: 'ontario', name: ONTARIO.name, portals: 2, datasets: 964 },
    { id: 'quebec', name: QUEBEC.name, portals: 1, datasets: 397 }],
  updated_at: '2026-11-15T21:30:04.000Z'
};

export const envelope = (data = DIRECTORY) => ({ data, pagination: { nextCursor: null }, meta: { source: 'canquery', license: null, upstream: null } });
