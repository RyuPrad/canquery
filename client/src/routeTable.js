import { matchRoutes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { lazyPage } from './utils/lazyPage.js';
import { hostedPart } from './extensions.js';

// The application's page routes, in one table: App renders them, and a direct
// visit preloads the page its address matches before the first render (the
// same module the server's HTML already modulepreloads, routeAssets.js).
// Other page code is fetched only when the visitor opens that route.
const DatasetPage = lazyPage(() => import('./pages/DatasetPage.jsx'));
const DatasetsPage = lazyPage(() => import('./pages/DatasetsPage.jsx'));
const ResourcePage = lazyPage(() => import('./pages/ResourcePage.jsx'));
const OrganizationsPage = lazyPage(() => import('./pages/OrganizationsPage.jsx'));
const OrganizationPage = lazyPage(() => import('./pages/OrganizationPage.jsx'));
const DocsPage = lazyPage(() => import('./pages/DocsPage.jsx'));
const FaqPage = lazyPage(() => import('./pages/FaqPage.jsx'));
const AboutPage = lazyPage(() => import('./pages/AboutPage.jsx'));
const PlacesPage = lazyPage(() => import('./pages/PlacesPage.jsx'));
const PlacePage = lazyPage(() => import('./pages/PlacePage.jsx'));
const PrivacyPage = lazyPage(() => import('./pages/PrivacyPage.jsx'));
const BlogPage = lazyPage(() => import('./pages/BlogPage.jsx'));
const InsightsPage = lazyPage(() => import('./pages/InsightsPage'));
const LmiaPage = lazyPage(() => import('./pages/LmiaPage.jsx'));
const LmiaEmployerPage = lazyPage(() => import('./pages/LmiaEmployerPage.jsx'));
const OasPage = lazyPage(() => import('./pages/OasPage.jsx'));

// Pages only the hosted service serves, such as pricing and the developer
// account. A hosted route that carries `preload` is loaded before a direct
// visit's first render too.
/** @type {{ path: string, element: any, preload?: () => Promise<unknown> }[]} */
export const HOSTED_ROUTES = hostedPart(import.meta.glob('./enterprise/routes.jsx', { eager: true }), []);

/** @type {{ path: string, page: any, props?: Record<string, unknown> }[]} */
export const PAGE_ROUTES = [
  { path: '/', page: HomePage },
  { path: '/insights', page: InsightsPage },
  { path: '/datasets', page: DatasetsPage },
  { path: '/datasets/:idOrName', page: DatasetPage },
  { path: '/resources/:id', page: ResourcePage },
  { path: '/organizations', page: OrganizationsPage },
  { path: '/organizations/:name', page: OrganizationPage },
  { path: '/places', page: PlacesPage },
  { path: '/places/:slug', page: PlacePage },
  { path: '/lmia', page: LmiaPage },
  { path: '/lmia/employers/:slug', page: LmiaEmployerPage },
  // The OAS benefit amounts: a hub and one page per official table, at an English
  // and a French address each. Static paths, so any other table number is not found.
  { path: '/oas', page: OasPage, props: { language: 'en', table: null } },
  ...[1, 2, 3, 4, 5].map((table) => ({ path: '/oas/table-' + table, page: OasPage, props: { language: 'en', table } })),
  { path: '/fr/sv', page: OasPage, props: { language: 'fr', table: null } },
  ...[1, 2, 3, 4, 5].map((table) => ({ path: '/fr/sv/tableau-' + table, page: OasPage, props: { language: 'fr', table } })),
  { path: '/docs', page: DocsPage },
  { path: '/faq', page: FaqPage },
  { path: '/about', page: AboutPage },
  { path: '/blog', page: BlogPage },
  { path: '/blog/:slug', page: BlogPage },
  { path: '/fr/blog', page: BlogPage, props: { language: 'fr' } },
  { path: '/fr/blog/:slug', page: BlogPage, props: { language: 'fr' } },
  { path: '/privacy', page: PrivacyPage }
];

/**
 * Loads the page module for a path, if it is a lazy page. Resolves whether or
 * not the import worked: a failed chunk is the error boundary's to report.
 * @param {string} pathname
 * @returns {Promise<void>}
 */
export function preloadRoute(pathname) {
  const routes = [
    ...PAGE_ROUTES.map(({ path, page }) => ({ path, preload: page?.preload })),
    ...HOSTED_ROUTES.map(({ path, preload }) => ({ path, preload }))
  ];
  const matches = matchRoutes(
    routes.map(({ path }) => ({ path })),
    pathname
  );
  const preload = matches ? routes.find(({ path }) => path === matches[0].route.path)?.preload : undefined;
  return typeof preload === 'function' ? preload().then(() => undefined, () => undefined) : Promise.resolve();
}
