-- Multi-source catalogue provenance, Canadian place hierarchy, and live map
-- metadata.  The migration is additive so the existing CKAN catalogue keeps
-- working while municipal sources are enabled one at a time.

CREATE TABLE IF NOT EXISTS catalog_sources (
    id text PRIMARY KEY,
    kind text NOT NULL,
    name_en text NOT NULL,
    name_fr text,
    homepage_url text NOT NULL,
    catalog_url text,
    upstream_host text NOT NULL,
    default_license_title_en text,
    default_license_title_fr text,
    default_license_url text,
    default_attribution_en text,
    default_attribution_fr text,
    enabled boolean NOT NULL DEFAULT true,
    sync_interval_hours integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO catalog_sources (
    id, kind, name_en, name_fr, homepage_url, catalog_url, upstream_host,
    default_license_title_en, default_license_title_fr,
    default_license_url, default_attribution_en, default_attribution_fr,
    sync_interval_hours
) VALUES (
    'open-canada',
    'ckan',
    'Government of Canada Open Data',
    'Données ouvertes du gouvernement du Canada',
    'https://open.canada.ca/data/en/',
    'https://open.canada.ca/data/api/3/action/',
    'open.canada.ca',
    'Open Government Licence – Canada',
    'Licence du gouvernement ouvert – Canada',
    'https://open.canada.ca/en/open-government-licence-canada',
    'Contains information licensed under the Open Government Licence – Canada.',
    'Contient des renseignements visés par la Licence du gouvernement ouvert – Canada.',
    1
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dataset_sources (
    source_id text NOT NULL REFERENCES catalog_sources(id),
    external_id text NOT NULL,
    dataset_id text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    landing_url text,
    license_title_en text,
    license_title_fr text,
    license_url text,
    attribution_en text,
    attribution_fr text,
    is_authoritative boolean NOT NULL DEFAULT false,
    raw jsonb,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_dataset_sources_dataset_id
    ON dataset_sources(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_sources_source_dataset
    ON dataset_sources(source_id, dataset_id);

INSERT INTO dataset_sources (
    source_id, external_id, dataset_id, landing_url, is_authoritative
)
SELECT
    'open-canada', d.id, d.id,
    'https://open.canada.ca/data/en/dataset/' || d.id,
    true
FROM datasets d
ON CONFLICT (source_id, external_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS places (
    id text PRIMARY KEY,
    slug text UNIQUE NOT NULL,
    kind text NOT NULL CHECK (kind IN ('country','province','territory','region','municipality')),
    name_en text NOT NULL,
    name_fr text,
    type_en text,
    type_fr text,
    parent_id text REFERENCES places(id),
    latitude double precision,
    longitude double precision,
    default_zoom smallint,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CHECK (default_zoom IS NULL OR default_zoom BETWEEN 0 AND 22)
);

CREATE INDEX IF NOT EXISTS idx_places_parent ON places(parent_id);
CREATE INDEX IF NOT EXISTS idx_places_kind_name ON places(kind, name_en);

CREATE TABLE IF NOT EXISTS place_identifiers (
    place_id text NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    scheme text NOT NULL,
    vintage text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (scheme, vintage, value),
    UNIQUE (place_id, scheme, vintage)
);

CREATE TABLE IF NOT EXISTS place_aliases (
    slug text PRIMARY KEY,
    place_id text NOT NULL REFERENCES places(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_places (
    source_id text NOT NULL REFERENCES catalog_sources(id),
    dataset_id text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    place_id text NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    relationship text NOT NULL CHECK (relationship IN ('direct','coverage')),
    includes_descendants boolean NOT NULL DEFAULT false,
    assignment_method text NOT NULL CHECK (assignment_method IN ('source','record','manual','spatial')),
    PRIMARY KEY (source_id, dataset_id, place_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_dataset_places_place
    ON dataset_places(place_id, dataset_id);

CREATE TABLE IF NOT EXISTS resource_maps (
    resource_id text PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider = 'arcgis'),
    service_url text NOT NULL,
    geometry_type text NOT NULL CHECK (geometry_type IN ('point','multipoint','polyline','polygon')),
    extent jsonb,
    object_id_field text,
    display_field text,
    fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    max_record_count integer,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (max_record_count IS NULL OR max_record_count > 0)
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS place_id text REFERENCES places(id);
CREATE INDEX IF NOT EXISTS idx_organizations_place_id ON organizations(place_id);

ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS source_id text REFERENCES catalog_sources(id);
UPDATE sync_runs
SET source_id = 'open-canada'
WHERE source_id IS NULL AND kind IN ('full', 'incremental');
CREATE INDEX IF NOT EXISTS idx_sync_runs_source_finished
    ON sync_runs(source_id, finished_at DESC) WHERE ok;

-- Core places make the first source deployable before the complete SGC import
-- script is run. Stable internal ids survive future SGC vintages.
INSERT INTO places (id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id, latitude, longitude, default_zoom)
VALUES
    ('ca', 'canada', 'country', 'Canada', 'Canada', 'Country', 'Pays', NULL, 56.1304, -106.3468, 4),
    ('ca-on', 'ontario', 'province', 'Ontario', 'Ontario', 'Province', 'Province', 'ca', 50.0000, -85.0000, 5),
    ('ca-on-durham', 'durham-on', 'region', 'Durham', 'Durham', 'Regional municipality', 'Municipalité régionale', 'ca-on', 44.0569, -78.8570, 9),
    ('ca-on-oshawa', 'oshawa-on', 'municipality', 'Oshawa', 'Oshawa', 'City', 'Ville', 'ca-on-durham', 43.8971, -78.8658, 11)
ON CONFLICT (id) DO NOTHING;

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('ca', 'sgc', '2021', '01'),
    ('ca-on', 'sgc-pr', '2021', '35'),
    ('ca-on-durham', 'sgc-cd', '2021', '3518'),
    ('ca-on-oshawa', 'sgc-csd', '2021', '3518013')
ON CONFLICT (scheme, vintage, value) DO NOTHING;
