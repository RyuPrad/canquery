# Data guides

Articles live here as paired English/French Markdown files. `index.json` is the
single manifest for the blog API, initial HTML, translations, related guides,
and sitemap. The server renders the same Markdown for initial HTML and React.

## Write or update a guide

1. Choose a specific data-seeking task supported by an admitted dataset. Verify
   the official publisher, source description, and actual table/map/download workflow.
2. Add one manifest entry with a stable `id`, `topic`, localized search `query`,
   canonical `datasetId`, dataset link, exploration link, and `view` (`table`,
   `map`, or `download`). Add `place` only when the guide is geographic. Add `en`
   and `fr` editions with unique slugs, titles, descriptions, and topic names;
   geographic guides also need place names. An edition can override `explore`
   when the actual resource differs by file language. Download actions open the
   resource details before the visitor chooses to download.
3. Write `<id>.en.md` and `<id>.fr.md`. Start headings at `##`; the page supplies
   the title. Use plain language, useful steps, official source links, and
   relevant coverage limits. Do not infer real-world changes from metadata dates.
4. Set `status` to `draft` while preparing content. Drafts are excluded from
   public APIs, HTML, related-guide cards, and sitemaps. Both translations must
   exist before the content verifier passes, including for drafts.
5. Record the actual publication date, last substantive article update, and
   date the data links/workflow were checked. Dates use `YYYY-MM-DD`; routine
   deployments must not advance them. Use the organizational byline CanQuery.
6. Run `npm run blog:check --prefix server` and the release verifier. Review both
   editions on mobile and without JavaScript, then publish through the normal PR
   and deployment process.

Raw HTML is disabled. Links accept HTTPS/HTTP, same-origin paths, or fragment
anchors. Images must use same-origin paths and meaningful alternative text.
Keep article bodies independent of live catalogue availability. Update or
withdraw guides when a source no longer supports the described task.
Related guides accept the canonical dataset ID or its published dataset slug;
this lookup uses the manifest and does not query the catalogue database.

English routes use `/blog/:slug`; French routes use `/fr/blog/:slug`. Translation
URLs have their own canonical and reciprocal `hreflang` annotations. Do not
rename a published slug without adding and testing a permanent redirect.

New topics and spelling suggestions belong in `server/services/localSearch.js`.
Keep the vocabulary reviewed and bounded, preserve additional query terms, and
test both useful matches and misleading stem matches against PostgreSQL.
