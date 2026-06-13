import { useEffect } from 'react'
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
    <div className="text-center py-28 space-y-4 oc-fade">
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
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/datasets/:idOrName" element={<DatasetPage />} />
          <Route path="/resources/:id" element={<ResourcePage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
