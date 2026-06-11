import { Routes, Route, Link } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import DatasetPage from './pages/DatasetPage'
import ResourcePage from './pages/ResourcePage'
import OrganizationsPage from './pages/OrganizationsPage'
import DocsPage from './pages/DocsPage'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-base-100 text-base-content">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/datasets/:idOrName" element={<DatasetPage />} />
          <Route path="/resources/:id" element={<ResourcePage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route
            path="*"
            element={
              <div className="text-center py-20 space-y-3">
                <h1 className="text-2xl font-bold">Page not found</h1>
                <Link to="/" className="link">
                  Back to search
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
