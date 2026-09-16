-- Additive: existing tables remain usable; NULL versions are revalidated lazily.
ALTER TABLE ingested_resources ADD COLUMN IF NOT EXISTS source_version text;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS preparation boolean NOT NULL DEFAULT false;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS source_version text;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS failure_code text;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS retry_at timestamptz;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS ingest_jobs_resource_latest ON ingest_jobs(resource_id, id DESC);
CREATE TABLE IF NOT EXISTS retired_ingest_tables (
    table_name text PRIMARY KEY,
    resource_id text NOT NULL,
    byte_size bigint NOT NULL,
    retired_at timestamptz NOT NULL DEFAULT now()
);
