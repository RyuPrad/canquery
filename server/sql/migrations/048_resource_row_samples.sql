-- The first rows of a resource's table, for the page a crawler reads without
-- running the application. scripts/sample-resource-rows.js (the deployment
-- owner's scheduled job) reads them from a live DataStore table or from the
-- start of a CSV file; the resource page (spaController) shows them only while
-- the resource is still at the version they were read from. A failed recheck
-- keeps the last good sample. Rows go with their resource. Additive; the API
-- role reads the table through deploy/database/runtime-roles.sql.
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.resource_row_samples (
    resource_id text PRIMARY KEY REFERENCES public.resources(id) ON DELETE CASCADE,
    origin text NOT NULL CHECK (origin IN ('datastore', 'file')),
    status text NOT NULL CHECK (status IN ('ok', 'unsupported', 'failed')),
    checked_version text NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now(),
    next_check_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    failure_code text CHECK (failure_code ~ '^[a-z_]{1,40}$'),
    source_version text,
    sampled_at timestamptz,
    fields jsonb,
    records jsonb,
    columns_total integer CHECK (columns_total >= 0),
    upstream_total bigint CHECK (upstream_total >= 0),
    bytes_read integer CHECK (bytes_read >= 0),
    CHECK ((fields IS NULL) = (records IS NULL)),
    CHECK ((fields IS NULL) = (source_version IS NULL) AND (fields IS NULL) = (sampled_at IS NULL)),
    CHECK (status <> 'ok' OR fields IS NOT NULL),
    CHECK ((status = 'ok') = (failure_code IS NULL))
);

CREATE INDEX idx_resource_row_samples_due ON public.resource_row_samples (next_check_at);
