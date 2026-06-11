CREATE SCHEMA IF NOT EXISTS store;

CREATE TABLE IF NOT EXISTS organizations (
    id text PRIMARY KEY,
    name text UNIQUE NOT NULL,
    title_en text,
    title_fr text,
    dataset_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS datasets (
    id text PRIMARY KEY,
    name text UNIQUE NOT NULL,
    title_en text,
    title_fr text,
    notes_en text,
    notes_fr text,
    org_id text,
    keywords_en text[] NOT NULL DEFAULT array[]::text[],
    keywords_fr text[] NOT NULL DEFAULT array[]::text[],
    metadata_modified timestamptz,
    raw jsonb,
    search_tsv tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title_en,'') || ' ' || coalesce(notes_en,'')) ||
        to_tsvector('french', coalesce(title_fr,'') || ' ' || coalesce(notes_fr,''))
    ) STORED
);

CREATE TABLE IF NOT EXISTS resources (
    id text PRIMARY KEY,
    dataset_id text NOT NULL,
    name_en text,
    name_fr text,
    format text,
    url text,
    size_bytes bigint,
    datastore_active boolean NOT NULL DEFAULT false,
    language text,
    last_modified timestamptz,
    raw jsonb
);

CREATE TABLE IF NOT EXISTS ingested_resources (
    resource_id text PRIMARY KEY,
    table_name text UNIQUE NOT NULL,
    row_count bigint,
    byte_size bigint,
    columns jsonb,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    last_accessed_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'ready'
);

CREATE TABLE IF NOT EXISTS ingest_jobs (
    id bigserial PRIMARY KEY,
    resource_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
    attempts integer NOT NULL DEFAULT 0,
    error text,
    claimed_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id bigserial PRIMARY KEY,
    kind text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    ok boolean,
    datasets_upserted integer,
    resources_upserted integer,
    error text
);

CREATE TABLE IF NOT EXISTS ingest_runs (
    id bigserial PRIMARY KEY,
    resource_id text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    ok boolean,
    rows_loaded bigint,
    bytes_loaded bigint,
    error text
);

CREATE TABLE IF NOT EXISTS sync_progress (
    key text PRIMARY KEY,
    value jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- datasets indexes
CREATE INDEX IF NOT EXISTS idx_datasets_search_tsv ON datasets USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_datasets_keywords_en ON datasets USING GIN(keywords_en);
CREATE INDEX IF NOT EXISTS idx_datasets_keywords_fr ON datasets USING GIN(keywords_fr);
CREATE INDEX IF NOT EXISTS idx_datasets_metadata_modified ON datasets(metadata_modified);
CREATE INDEX IF NOT EXISTS idx_datasets_org_id ON datasets(org_id);

-- resources indexes
CREATE INDEX IF NOT EXISTS idx_resources_dataset_id ON resources(dataset_id);
CREATE INDEX IF NOT EXISTS idx_resources_format ON resources(format);
CREATE INDEX IF NOT EXISTS idx_resources_datastore_active ON resources(id) WHERE datastore_active;

-- ingest_jobs indexes
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status_id ON ingest_jobs(status, id);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_jobs_active_resource_uniq ON ingest_jobs(resource_id) WHERE status IN ('pending','running');
