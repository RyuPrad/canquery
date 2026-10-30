-- The pages Google showed in its web results, by day: the sitemap of noindex
-- pages that Google still shows reads it (sitemapController). The view runs
-- with its owner's rights, so the API role reads these two columns through
-- deploy/database/runtime-roles.sql's single grant and still cannot read the
-- Search Console tables: queries, clicks, positions, countries and devices stay
-- with the deployment owner. Additive; no data changes.
SET LOCAL lock_timeout = '3s';
CREATE VIEW public.search_console_page_dates AS
    SELECT data_date, value AS page
    FROM public.search_console_breakdowns
    WHERE search_type = 'web' AND dimension = 'page' AND impressions > 0;
