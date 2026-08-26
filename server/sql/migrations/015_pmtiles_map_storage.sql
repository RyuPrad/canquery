-- Object-storage-backed PMTiles archives. Existing ArcGIS and local PostGIS
-- providers keep their current metadata and behavior.

ALTER TABLE resource_maps DROP CONSTRAINT IF EXISTS resource_maps_provider_check;
ALTER TABLE resource_maps ADD CONSTRAINT resource_maps_provider_check
    CHECK (provider IN ('arcgis', 'canquery', 'pmtiles'));

ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS storage_etag text;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS storage_sha256 text;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS tile_min_zoom smallint;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS tile_max_zoom smallint;
ALTER TABLE resource_maps ADD COLUMN IF NOT EXISTS tile_layer text;

ALTER TABLE resource_maps DROP CONSTRAINT IF EXISTS resource_maps_pmtiles_metadata_check;
ALTER TABLE resource_maps ADD CONSTRAINT resource_maps_pmtiles_metadata_check CHECK (
    provider <> 'pmtiles' OR (
        storage_key IS NOT NULL AND storage_key <> '' AND
        storage_etag IS NOT NULL AND storage_etag <> '' AND
        storage_sha256 ~ '^[0-9a-f]{64}$' AND
        tile_min_zoom BETWEEN 0 AND 22 AND
        tile_max_zoom BETWEEN tile_min_zoom AND 22 AND
        tile_layer ~ '^[A-Za-z0-9_-]{1,64}$'
    )
);

CREATE INDEX IF NOT EXISTS idx_resource_maps_pmtiles_storage
    ON resource_maps(storage_key) WHERE provider = 'pmtiles';
