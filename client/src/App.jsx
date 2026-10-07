import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import AnalyticsBridge from './components/AnalyticsBridge.jsx'
import { PromotionTracking } from './components/PromotionTracking.jsx'
import RouteHead from './components/RouteHead.jsx'
import { MapleLeaf } from './components/Icons.jsx'
import { useLang } from './i18n.jsx'

// Direct visits preload their route through the server's build manifest.
// Other page code is fetched only when the visitor opens that route.
const DatasetPage = lazy(() => import('./pages/DatasetPage.jsx'));
const DatasetsPage = lazy(() => import('./pages/DatasetsPage.jsx'));
const ResourcePage = lazy(() => import('./pages/ResourcePage.jsx'));
const OrganizationsPage = lazy(() => import('./pages/OrganizationsPage.jsx'));
const OrganizationPage = lazy(() => import('./pages/OrganizationPage.jsx'));
const DocsPage = lazy(() => import('./pages/DocsPage.jsx'));
const PlacesPage = lazy(() => import('./pages/PlacesPage.jsx'));
const PlacePage = lazy(() => import('./pages/PlacePage.jsx'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.jsx'));
const PricingPage = lazy(() => import('./pages/PricingPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));
const TermsPage = lazy(() => import('./pages/TermsPage.jsx'));
const BlogPage = lazy(() => import('./pages/BlogPage.jsx'));
const InsightsPage = lazy(() => import('./pages/InsightsPage'))

function ScrollToTop() {
  const { pathname, search } = useLocation()
  const page = new URLSearchParams(search).get('page')
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname, page])
  return null
}

function NotFound() {
  const { t } = useLang()
  return (
    <div className="text-center py-28 space-y-4 cq-fade">
      <MapleLeaf size={44} className="mx-auto text-primary opacity-80" />
      <h1 className="text-3xl font-bold font-display">{t('common.not_found')}</h1>
      <Link to="/" className="link link-hover text-base-content/60">
        {t('common.back_search')}
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <PromotionTracking><div className="min-h-screen flex flex-col text-base-content">
      <ScrollToTop />
      <RouteHead />
      <AnalyticsBridge />
      <Navbar />
      <main className="cq-app-main flex-1 w-full">
        <Suspense fallback={<div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8"><div className="cq-skel h-[60vh] rounded-2xl" /></div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/datasets/:idOrName" element={<DatasetPage />} />
            <Route path="/resources/:id" element={<ResourcePage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/organizations/:name" element={<OrganizationPage />} />
            <Route path="/places" element={<PlacesPage />} />
            <Route path="/places/:slug" element={<PlacePage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/blog/:slug" element={<BlogPage />} />
            <Route path="/fr/blog" element={<BlogPage language="fr" />} />
            <Route path="/fr/blog/:slug" element={<BlogPage language="fr" />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/account" element={<AccountPage />} />
            {['login', 'signup', 'forgot-password', 'reset-password'].map(path => <Route key={path} path={'/' + path} element={<AuthPage key={path} />} />)}
            <Route path="/terms" element={<TermsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div></PromotionTracking>
  )
}
