-- PostGIS-backed local map cache. Install the operating-system PostGIS package
-- and create the extension as a PostgreSQL administrator before migrating.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS map_store;

CREATE TABLE IF NOT EXISTS map_store.features (
    resource_id text NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
    feature_id bigint NOT NULL,
    geom geometry(Geometry, 4326) NOT NULL,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (resource_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_map_features_geom
    ON map_store.features USING gist (geom);

ALTER TABLE resource_maps DROP CONSTRAINT IF EXISTS resource_maps_provider_check;
ALTER TABLE resource_maps ADD CONSTRAINT resource_maps_provider_check
    CHECK (provider IN ('arcgis', 'canquery'));
ALTER TABLE resource_maps DROP CONSTRAINT IF EXISTS resource_maps_geometry_type_check;
ALTER TABLE resource_maps ADD CONSTRAINT resource_maps_geometry_type_check
    CHECK (geometry_type IN ('point','multipoint','polyline','polygon','mixed'));
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS feature_count bigint;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS byte_size bigint;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS indexed_at timestamptz;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS source_version text;

CREATE TABLE IF NOT EXISTS map_index_jobs (
    resource_id text PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    desired_version text NOT NULL,
    indexed_version text,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','ready','skipped','failed')),
    candidate jsonb NOT NULL DEFAULT '{}'::jsonb,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    worker_id uuid,
    claimed_at timestamptz,
    heartbeat_at timestamptz,
    finished_at timestamptz,
    error text,
    feature_count bigint,
    vertex_count bigint,
    downloaded_bytes bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_map_index_jobs_pending
    ON map_index_jobs(updated_at, resource_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_map_index_jobs_running
    ON map_index_jobs(heartbeat_at) WHERE status = 'running';
