import { matchRoutes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { lazyPage } from './utils/lazyPage.js';

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
  const matches = matchRoutes(
    PAGE_ROUTES.map(({ path }) => ({ path })),
    pathname
  );
  const route = matches && PAGE_ROUTES.find(({ path }) => path === matches[0].route.path);
  const preload = route?.page?.preload;
  return typeof preload === 'function' ? preload().then(() => undefined, () => undefined) : Promise.resolve();
}
