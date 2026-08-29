-- Canonicalize Québec City and Laval in the 2021 Statistics Canada hierarchy.
-- Québec (CD 2423) contains multiple municipalities, so its city remains the
-- CSD 2423027 beneath a distinct regional place. Laval's CD 2465 is a
-- single-tier city with CSD 2465005, so CanQuery exposes one canonical city
-- while retaining both official identifiers.

-- Release the public Québec region slug before assigning the city slug.
UPDATE places
SET slug = 'quebec-region-qc', updated_at = now()
WHERE id = 'sgc-cd-2423' AND slug <> 'quebec-region-qc';

-- Canonical slugs must not also remain aliases after an earlier refresh.
DELETE FROM place_aliases
WHERE slug IN (
    'quebec-region-qc', 'quebec-qc', 'quebec-qc-2423',
    'quebec-qc-2423027', 'laval-qc', 'laval-qc-2465',
    'laval-qc-2465005', 'sgc-csd-2465005'
);

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-pr-24', 'quebec', 'province',
    'Quebec', 'Québec', 'Province', 'Province', 'ca',
    NULL, NULL, NULL, true, false
) ON CONFLICT (id) DO UPDATE SET
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

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-2423', 'quebec-region-qc', 'region',
    'Québec', 'Québec', 'Census division', 'Division de recensement',
    'sgc-pr-24', NULL, NULL, NULL, true, false
) ON CONFLICT (id) DO UPDATE SET
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
    featured = false,
    updated_at = now();

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-csd-2423027', 'quebec-qc', 'municipality',
    'Québec', 'Québec', 'City', 'Ville', 'sgc-cd-2423',
    46.8139, -71.2080, 10, true, true
) ON CONFLICT (id) DO UPDATE SET
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
    featured = true,
    updated_at = now();

-- Laval is a single-tier city in the SGC. Move any existing references from
-- the generic subdivision row before removing that duplicate place.
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-2465', 'laval-qc', 'municipality',
    'Laval', 'Laval', 'City', 'Ville', 'sgc-pr-24',
    45.6066, -73.7124, 10, true, true
) ON CONFLICT (id) DO UPDATE SET
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
    featured = true,
    updated_at = now();

INSERT INTO dataset_places (
    source_id, dataset_id, place_id, relationship,
    includes_descendants, assignment_method
)
SELECT source_id, dataset_id, 'sgc-cd-2465', relationship,
       includes_descendants, assignment_method
FROM dataset_places
WHERE place_id = 'sgc-csd-2465005'
ON CONFLICT (source_id, dataset_id, place_id, relationship) DO UPDATE SET
    includes_descendants = EXCLUDED.includes_descendants,
    assignment_method = EXCLUDED.assignment_method;

DELETE FROM dataset_places WHERE place_id = 'sgc-csd-2465005';
UPDATE organizations SET place_id = 'sgc-cd-2465'
WHERE place_id = 'sgc-csd-2465005';

DELETE FROM place_identifiers WHERE place_id = 'sgc-csd-2465005';
DELETE FROM places WHERE id = 'sgc-csd-2465005';

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-pr-24', 'sgc-pr', '2021', '24'),
    ('sgc-cd-2423', 'sgc-cd', '2021', '2423'),
    ('sgc-csd-2423027', 'sgc-csd', '2021', '2423027'),
    ('sgc-cd-2465', 'sgc-cd', '2021', '2465'),
    ('sgc-cd-2465', 'sgc-csd', '2021', '2465005')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

INSERT INTO place_aliases (slug, place_id)
VALUES
    ('quebec-qc-2423', 'sgc-cd-2423'),
    ('quebec-qc-2423027', 'sgc-csd-2423027'),
    ('laval-qc-2465', 'sgc-cd-2465'),
    ('laval-qc-2465005', 'sgc-cd-2465'),
    ('sgc-csd-2465005', 'sgc-cd-2465')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
