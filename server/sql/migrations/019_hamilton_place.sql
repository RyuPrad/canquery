-- The City of Hamilton is simultaneously Statistics Canada census division
-- 3525 and census subdivision 3525005. CanQuery exposes one canonical city
-- while keeping both official identifiers. The unrelated Township of Hamilton
-- in Northumberland receives an explicit township slug so the major city can
-- own /places/hamilton-on.

-- Canonical place slugs must never also remain in the alias table.
DELETE FROM place_aliases
WHERE slug IN ('hamilton-on', 'hamilton-township-on');

-- Seed the township ancestry as well as renaming an existing full-SGC import.
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-3514', 'northumberland-on', 'region',
    'Northumberland', 'Northumberland', 'Census division', 'Division de recensement',
    'ca-on', NULL, NULL, NULL, true, false
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
    'sgc-csd-3514019', 'hamilton-township-on', 'municipality',
    'Hamilton', 'Hamilton', 'Township', 'Canton', 'sgc-cd-3514',
    NULL, NULL, NULL, true, false
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
    'sgc-cd-3525', 'hamilton-on', 'municipality',
    'Hamilton', 'Hamilton', 'City', 'Ville', 'ca-on',
    43.2557, -79.8711, 9, true, true
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

-- Preserve links that may have been created against the duplicate city
-- subdivision before removing it. Overlapping links remain harmless.
INSERT INTO dataset_places (
    source_id, dataset_id, place_id, relationship,
    includes_descendants, assignment_method
)
SELECT source_id, dataset_id, 'sgc-cd-3525', relationship,
       includes_descendants, assignment_method
FROM dataset_places
WHERE place_id = 'sgc-csd-3525005'
ON CONFLICT (source_id, dataset_id, place_id, relationship) DO UPDATE SET
    includes_descendants = EXCLUDED.includes_descendants,
    assignment_method = EXCLUDED.assignment_method;

DELETE FROM dataset_places WHERE place_id = 'sgc-csd-3525005';
UPDATE organizations SET place_id = 'sgc-cd-3525'
WHERE place_id = 'sgc-csd-3525005';
DELETE FROM place_identifiers WHERE place_id = 'sgc-csd-3525005';

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-cd-3514', 'sgc-cd', '2021', '3514'),
    ('sgc-csd-3514019', 'sgc-csd', '2021', '3514019'),
    ('sgc-cd-3525', 'sgc-cd', '2021', '3525'),
    ('sgc-cd-3525', 'sgc-csd', '2021', '3525005')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

DELETE FROM places WHERE id = 'sgc-csd-3525005';

INSERT INTO place_aliases (slug, place_id)
VALUES
    ('hamilton-on-3514019', 'sgc-csd-3514019'),
    ('hamilton-on-3525', 'sgc-cd-3525'),
    ('hamilton-on-3525005', 'sgc-cd-3525'),
    ('sgc-csd-3525005', 'sgc-cd-3525')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
