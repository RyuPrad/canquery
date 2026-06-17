-- Curated "Top 100 Downloaded Datasets" leaderboard, rebuilt by scripts/seed-top100.js
-- from the latest monthly snapshot of the Open Government Analytics resource. One row
-- per dataset; resource_id is the representative (latest-period) file we ingest + chart.
CREATE TABLE IF NOT EXISTS top_downloads (
    dataset_id text PRIMARY KEY,
    rank integer NOT NULL,
    title_en text,
    title_fr text,
    department text,
    ministere text,
    downloads integer NOT NULL DEFAULT 0,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    history jsonb NOT NULL DEFAULT '[]'::jsonb,
    resource_id text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_top_downloads_rank ON top_downloads(rank);

-- Resources that must never be LRU-evicted from the store (the curated Top 100
-- representatives + the analytics source). Kept separate from ingested_resources
-- so a pin can outlive a drop-and-replace re-ingest and predate first ingestion.
CREATE TABLE IF NOT EXISTS pinned_resources (
    resource_id text PRIMARY KEY,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
