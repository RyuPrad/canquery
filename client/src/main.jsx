import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted variable fonts: bundled by Vite, no CDN, CSP-safe.
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App'
import { preloadRoute } from './routeTable.js'
import { LangProvider } from './i18n.jsx'
import { ThemeProvider } from './theme.jsx'
import { watchEngagement } from './utils/engagement.js'

watchEngagement()

// The server's HTML stays on screen until the page itself can replace it: the
// current route's code (already modulepreloaded by the HTML) is loaded first,
// so the first render shows the page rather than a skeleton. A slow or failed
// load renders anyway after three seconds; the page then loads as usual.
let started = false
function start() {
  if (started) return
  started = true
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <ThemeProvider>
          <LangProvider>
            <App />
          </LangProvider>
        </ThemeProvider>
      </BrowserRouter>
    </StrictMode>
  )
}
setTimeout(start, 3000)
preloadRoute(window.location.pathname).finally(start)
