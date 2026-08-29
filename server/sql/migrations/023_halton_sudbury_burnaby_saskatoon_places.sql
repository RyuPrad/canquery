-- Canonicalize Halton Region cluster (Oakville, Burlington, Milton, Halton Hills),
-- Greater Sudbury (single-tier merge), Burnaby, and Saskatoon (Saskatchewan)
-- in the 2021 Statistics Canada hierarchy.

-- Release the public Halton region slug
UPDATE places
SET slug = 'halton-region-on', updated_at = now()
WHERE id = 'sgc-cd-3524' AND slug <> 'halton-region-on';

-- Canonical slugs must not also remain aliases after an earlier refresh.
DELETE FROM place_aliases
WHERE slug IN (
    'halton-region-on',
    'halton-on',
    'oakville-on',
    'burlington-on',
    'milton-on',
    'halton-hills-on',
    'greater-sudbury-on',
    'sudbury-on',
    'greater-sudbury-grand-sudbury-on',
    'burnaby-bc',
    'saskatchewan',
    'division-no-11-sk',
    'saskatoon-sk',
    'greater-sudbury-on-3553',
    'halton-region-on-3524',
    'sgc-csd-3553005'
);

-- Greater Sudbury is a single-tier city in the SGC (like Ottawa, Toronto, Hamilton, and Laval).
-- Move any existing references from the generic subdivision row before removing that duplicate place.
INSERT INTO dataset_places (
    source_id, dataset_id, place_id, relationship,
    includes_descendants, assignment_method
)
SELECT source_id, dataset_id, 'sgc-cd-3553', relationship,
       includes_descendants, assignment_method
FROM dataset_places
WHERE place_id = 'sgc-csd-3553005'
ON CONFLICT (source_id, dataset_id, place_id, relationship) DO UPDATE SET
    includes_descendants = EXCLUDED.includes_descendants,
    assignment_method = EXCLUDED.assignment_method;

DELETE FROM dataset_places WHERE place_id = 'sgc-csd-3553005';
UPDATE organizations SET place_id = 'sgc-cd-3553' WHERE place_id = 'sgc-csd-3553005';
DELETE FROM place_identifiers WHERE place_id = 'sgc-csd-3553005';
DELETE FROM places WHERE id = 'sgc-csd-3553005';

-- Provinces
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('ca-on', 'ontario', 'province', 'Ontario', 'Ontario', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-59', 'british-columbia', 'province', 'British Columbia', 'Colombie-Britannique', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-47', 'saskatchewan', 'province', 'Saskatchewan', 'Saskatchewan', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false)
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

-- Census Divisions / Regions
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-cd-3524', 'halton-region-on', 'region', 'Halton', 'Halton', 'Regional municipality', 'Municipalité régionale', 'ca-on', 43.4900, -79.8800, 9, true, true),
    ('sgc-cd-3553', 'greater-sudbury-on', 'municipality', 'Greater Sudbury', 'Grand Sudbury', 'City', 'Ville', 'ca-on', 46.4900, -80.9900, 9, true, true),
    ('sgc-cd-5915', 'greater-vancouver-bc', 'region', 'Greater Vancouver', 'Greater Vancouver', 'Census division', 'Division de recensement', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-4711', 'division-no-11-sk', 'region', 'Division No. 11', 'Division No. 11', 'Census division', 'Division de recensement', 'sgc-pr-47', NULL, NULL, NULL, true, false)
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

-- Municipalities
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-csd-3524001', 'oakville-on', 'municipality', 'Oakville', 'Oakville', 'Town', 'Ville', 'sgc-cd-3524', 43.4675, -79.6877, 10, true, true),
    ('sgc-csd-3524002', 'burlington-on', 'municipality', 'Burlington', 'Burlington', 'City', 'Ville', 'sgc-cd-3524', 43.3255, -79.7990, 10, true, true),
    ('sgc-csd-3524009', 'milton-on', 'municipality', 'Milton', 'Milton', 'Town', 'Ville', 'sgc-cd-3524', 43.5183, -79.8774, 10, true, true),
    ('sgc-csd-3524015', 'halton-hills-on', 'municipality', 'Halton Hills', 'Halton Hills', 'Town', 'Ville', 'sgc-cd-3524', 43.6300, -79.9500, 9, true, true),
    ('sgc-csd-5915025', 'burnaby-bc', 'municipality', 'Burnaby', 'Burnaby', 'City', 'Ville', 'sgc-cd-5915', 49.2488, -122.9805, 10, true, true),
    ('sgc-csd-4711066', 'saskatoon-sk', 'municipality', 'Saskatoon', 'Saskatoon', 'City', 'Ville', 'sgc-cd-4711', 52.1332, -106.6700, 10, true, true)
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
    ('sgc-cd-3524', 'sgc-cd', '2021', '3524'),
    ('sgc-csd-3524001', 'sgc-csd', '2021', '3524001'),
    ('sgc-csd-3524002', 'sgc-csd', '2021', '3524002'),
    ('sgc-csd-3524009', 'sgc-csd', '2021', '3524009'),
    ('sgc-csd-3524015', 'sgc-csd', '2021', '3524015'),
    ('sgc-cd-3553', 'sgc-cd', '2021', '3553'),
    ('sgc-cd-3553', 'sgc-csd', '2021', '3553005'),
    ('sgc-csd-5915025', 'sgc-csd', '2021', '5915025'),
    ('sgc-pr-47', 'sgc-pr', '2021', '47'),
    ('sgc-cd-4711', 'sgc-cd', '2021', '4711'),
    ('sgc-csd-4711066', 'sgc-csd', '2021', '4711066')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Durable Aliases
INSERT INTO place_aliases (slug, place_id)
VALUES
    ('sudbury-on', 'sgc-cd-3553'),
    ('greater-sudbury-grand-sudbury-on', 'sgc-cd-3553'),
    ('greater-sudbury-on-3553', 'sgc-cd-3553'),
    ('sgc-csd-3553005', 'sgc-cd-3553'),
    ('halton-on', 'sgc-cd-3524'),
    ('halton-region-on-3524', 'sgc-cd-3524')
ON CONFLICT (slug) DO UPDATE SET
    place_id = EXCLUDED.place_id;
