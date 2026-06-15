# Contributing to canquery

Thanks for your interest! canquery is an independent open-source project that puts
one consistent query API + UI over Canada's open data portal. Contributions -
bug reports, fixes, features, docs - are welcome.

## Getting set up

See **[README.md](README.md) → Local setup** for the full walkthrough. The short
version (Node 20+, PostgreSQL 16):

```bash
# server
cd server && cp .env.example .env   # fill in CANQUERY_DATABASE_URL
npm install && npm run migrate
node scripts/catalog-sync.js --limit 200   # small, polite real harvest
npm run dev                                 # API on :3100

# client (separate terminal)
cd client && npm install && npm run dev     # Vite on :5173, proxies /api → :3100
```

## Before you open a PR

Both halves must be green (this is exactly what CI runs):

```bash
# server
cd server && npm run lint && npm test

# client
cd client && npm run lint && npm test && npm run build
```

- The server test suite **mocks the database**, so it runs without Postgres.
- Add or update tests for any behavior you change. Conventions to follow:
  - Server: `catchAsync` + `AppError`; thin controllers, logic in services, SQL in
    `db/*Queries.js`; **parameterized SQL only** (values as `$N`, identifiers
    validated against a known list - never string-interpolate user input).
  - Client: keep user-facing strings in `client/src/i18n.jsx` (EN + FR).

## Pull requests

- Branch off `main`, keep PRs focused, and describe what changed and why.
- Make sure lint, tests, and the client build pass locally.
- By contributing you agree your contributions are licensed under the project's
  [MIT License](LICENSE).

## Reporting bugs / requesting features

Use the GitHub issue templates. For anything security-related, please follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## A note on the data

canquery mirrors and caches data from [open.canada.ca](https://open.canada.ca/data/),
which is provided under the Open Government Licence – Canada. Problems with the
**underlying datasets** themselves belong upstream with the publishing department,
not here - this project only makes them queryable.
