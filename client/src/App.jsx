import { Suspense } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import ScrollManager from './components/ScrollManager.jsx'
import QuietPageGuard from './components/QuietPageGuard.jsx'
import Footer from './components/Footer'
import AnalyticsBridge from './components/AnalyticsBridge.jsx'
import PageLoadBoundary from './components/PageLoadBoundary.jsx'
import { HOSTED_ROUTES, PAGE_ROUTES } from './routeTable.js'
import RouteHead from './components/RouteHead.jsx'
import { MapleLeaf } from './components/Icons.jsx'
import { useLang } from './i18n.jsx'

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
  const { pathname } = useLocation()
  return (
    <div className="min-h-screen flex flex-col text-base-content">
      <ScrollManager />
      <QuietPageGuard />
      <RouteHead />
      <AnalyticsBridge />
      <Navbar />
      <main className="cq-app-main flex-1 w-full">
        <PageLoadBoundary resetKey={pathname}>
          <Suspense fallback={<div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8"><div className="cq-skel h-[60vh] rounded-2xl" /></div>}>
            <Routes>
              {PAGE_ROUTES.map(({ path, page: Page, props }) => <Route key={path} path={path} element={<Page {...props} />} />)}
              {HOSTED_ROUTES.map(route => <Route key={route.path} path={route.path} element={route.element} />)}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </PageLoadBoundary>
      </main>
      <Footer />
    </div>
  )
}
