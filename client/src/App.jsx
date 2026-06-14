import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import DatasetPage from './pages/DatasetPage'
import ResourcePage from './pages/ResourcePage'
import OrganizationsPage from './pages/OrganizationsPage'
import DocsPage from './pages/DocsPage'
import { MapleLeaf } from './components/Icons.jsx'
import { useLang } from './i18n.jsx'

// The gallery renders charts (Recharts) - lazy-load it so the chart bundle only
// ships when someone opens /insights.
const InsightsPage = lazy(() => import('./pages/InsightsPage'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
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
    <div className="min-h-screen flex flex-col text-base-content">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1 w-full">
        <Suspense fallback={<div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8"><div className="cq-skel h-[60vh] rounded-2xl" /></div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/datasets/:idOrName" element={<DatasetPage />} />
            <Route path="/resources/:id" element={<ResourcePage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
