# CanQuery client

The React app behind [canquery.com](https://canquery.com): catalogue search and filters, place
and publisher pages, dataset and file pages with their Table, Chart and Map views, the data guides
and the API documentation page. It is built with React 19, Vite, React Router, Tailwind CSS and
daisyUI, with charts drawn by Recharts and maps by Leaflet and MapLibre GL.

In production the API serves the built app (`dist/`) together with server-rendered page content,
and the app takes over in the browser. See the [main README](../README.md) for the whole project.

## Commands

```bash
npm ci
npm run dev         # http://localhost:5173, proxies /api and /web-api to the API on :3100
npm test            # Vitest and Testing Library
npm run lint
npm run typecheck   # type checks of the boundary modules (tsconfig.boundaries.json)
npm run build       # production build in dist/
```

## Layout

| Folder | What it holds |
|---|---|
| `src/pages/` | One component per route; all but the home page load on demand |
| `src/components/` | Shared pieces: the data table, chart panel, map panels, catalogue filters, navigation |
| `src/hooks/` | Data loading and page state: resource metadata, rows, preparation jobs, search drafts |
| `src/utils/` | Plain functions: search state, the in-browser table engine, CSV export, formats |
| `src/api/` | API calls and checks on the shape of their responses |
| `src/i18n.jsx` | Every interface string, in English and French |

Hosted-only features of canquery.com plug in through `src/extensions.js`; without them the
extension points render nothing.
