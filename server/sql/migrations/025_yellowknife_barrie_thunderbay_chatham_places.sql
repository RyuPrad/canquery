-- Migration 025: Canonicalize Yellowknife (NT), Barrie, Thunder Bay,
-- Chatham-Kent, Kawartha Lakes, Summerland, Norfolk County, and Haldimand County
-- in the 2021 Statistics Canada hierarchy.

DELETE FROM place_aliases
WHERE slug IN (
    'yellowknife-nt',
    'barrie-on',
    'thunder-bay-on',
    'chatham-kent-on',
    'kawartha-lakes-on',
    'summerland-bc',
    'norfolk-county-on',
    'haldimand-county-on',
    'norfolk-on',
    'haldimand-on',
    'thunder-bay-district-on',
    'simcoe-county-on',
    'okanagan-similkameen-bc',
    'haldimand-norfolk-on',
    'thunder-bay-on-3558004'
);

-- Provinces / Territories
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('ca-on', 'ontario', 'province', 'Ontario', 'Ontario', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-59', 'british-columbia', 'province', 'British Columbia', 'Colombie-Britannique', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-61', 'northwest-territories', 'territory', 'Northwest Territories', 'Territoires du Nord-Ouest', 'Territory', 'Territoire', 'ca', NULL, NULL, NULL, true, false)
ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    enabled = true,
    featured = false,
    updated_at = now();

-- Census Divisions / Regions / Single-Tier Cities
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-cd-6106', 'region-6-nt', 'region', 'Region 6', 'Région 6', 'Region', 'Région', 'sgc-pr-61', NULL, NULL, NULL, true, false),
    ('sgc-cd-3543', 'simcoe-county-on', 'region', 'Simcoe', 'Simcoe', 'County', 'Comté', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-3558', 'thunder-bay-district-on', 'region', 'Thunder Bay', 'Thunder Bay', 'District', 'District', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-3536', 'chatham-kent-on', 'municipality', 'Chatham-Kent', 'Chatham-Kent', 'Municipality', 'Municipalité', 'ca-on', 42.4048, -82.1910, 9, true, true),
    ('sgc-cd-3516', 'kawartha-lakes-on', 'municipality', 'Kawartha Lakes', 'Kawartha Lakes', 'City', 'Ville', 'ca-on', 44.3564, -78.7408, 9, true, true),
    ('sgc-cd-5907', 'okanagan-similkameen-bc', 'region', 'Okanagan-Similkameen', 'Okanagan-Similkameen', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-3528', 'haldimand-norfolk-on', 'region', 'Haldimand-Norfolk', 'Haldimand-Norfolk', 'Census division', 'Division de recensement', 'ca-on', NULL, NULL, NULL, true, false)
ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    default_zoom = EXCLUDED.default_zoom,
    enabled = true,
    featured = EXCLUDED.featured,
    updated_at = now();

-- Municipalities / Census Subdivisions
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-csd-6106023', 'yellowknife-nt', 'municipality', 'Yellowknife', 'Yellowknife', 'City', 'Ville', 'sgc-cd-6106', 62.4540, -114.3718, 10, true, true),
    ('sgc-csd-3543042', 'barrie-on', 'municipality', 'Barrie', 'Barrie', 'City', 'Ville', 'sgc-cd-3543', 44.3894, -79.6903, 10, true, true),
    ('sgc-csd-3558004', 'thunder-bay-on', 'municipality', 'Thunder Bay', 'Thunder Bay', 'City', 'Ville', 'sgc-cd-3558', 48.3809, -89.2477, 10, true, true),
    ('sgc-csd-5907035', 'summerland-bc', 'municipality', 'Summerland', 'Summerland', 'District municipality', 'Municipalité de district', 'sgc-cd-5907', 49.6006, -119.6778, 10, true, true),
    ('sgc-csd-3528052', 'norfolk-county-on', 'municipality', 'Norfolk County', 'Norfolk County', 'City', 'Ville', 'sgc-cd-3528', 42.8333, -80.3833, 9, true, true),
    ('sgc-csd-3528018', 'haldimand-county-on', 'municipality', 'Haldimand County', 'Haldimand County', 'City', 'Ville', 'sgc-cd-3528', 42.9333, -79.8667, 9, true, true)
ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    default_zoom = EXCLUDED.default_zoom,
    enabled = true,
    featured = EXCLUDED.featured,
    updated_at = now();

-- Identifiers
INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-pr-61', 'sgc-pr', '2021', '61'),
    ('sgc-cd-6106', 'sgc-cd', '2021', '6106'),
    ('sgc-csd-6106023', 'sgc-csd', '2021', '6106023'),
    ('sgc-cd-3543', 'sgc-cd', '2021', '3543'),
    ('sgc-csd-3543042', 'sgc-csd', '2021', '3543042'),
    ('sgc-cd-3558', 'sgc-cd', '2021', '3558'),
    ('sgc-csd-3558004', 'sgc-csd', '2021', '3558004'),
    ('sgc-cd-3536', 'sgc-cd', '2021', '3536'),
    ('sgc-cd-3536', 'sgc-csd', '2021', '3536020'),
    ('sgc-cd-3516', 'sgc-cd', '2021', '3516'),
    ('sgc-cd-3516', 'sgc-csd', '2021', '3516010'),
    ('sgc-cd-5907', 'sgc-cd', '2021', '5907'),
    ('sgc-csd-5907035', 'sgc-csd', '2021', '5907035'),
    ('sgc-cd-3528', 'sgc-cd', '2021', '3528'),
    ('sgc-csd-3528052', 'sgc-csd', '2021', '3528052'),
    ('sgc-csd-3528018', 'sgc-csd', '2021', '3528018')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Durable Aliases
INSERT INTO place_aliases (slug, place_id)
VALUES
    ('norfolk-on', 'sgc-csd-3528052'),
    ('haldimand-on', 'sgc-csd-3528018'),
    ('thunder-bay-on-3558004', 'sgc-csd-3558004'),
    ('simcoe-on', 'sgc-cd-3543')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
