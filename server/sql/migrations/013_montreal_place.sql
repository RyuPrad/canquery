-- Montréal is a lower-tier census subdivision inside the distinct Montréal
-- census division. Keep both official places while exposing the city as the
-- featured standalone destination. Former mojibake and generic subdivision
-- slugs remain durable aliases.

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-pr-24', 'quebec', 'province', 'Quebec', 'Québec',
    'Province', 'Province', 'ca', NULL, NULL, NULL, true, false
) ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    enabled = true,
    updated_at = now();

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-2466', 'montreal-region-qc', 'region', 'Montréal', 'Montréal',
    'Census division', 'Division de recensement', 'sgc-pr-24',
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
    'sgc-csd-2466023', 'montreal-qc', 'municipality', 'Montréal', 'Montréal',
    'City', 'Ville', 'sgc-cd-2466', 45.5019, -73.5674, 10, true, true
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

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-pr-24', 'sgc-pr', '2021', '24'),
    ('sgc-cd-2466', 'sgc-cd', '2021', '2466'),
    ('sgc-csd-2466023', 'sgc-csd', '2021', '2466023')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

INSERT INTO place_aliases (slug, place_id)
VALUES
    ('montr-al-qc', 'sgc-cd-2466'),
    ('montr-al-qc-2466023', 'sgc-csd-2466023'),
    ('montreal-qc-2466023', 'sgc-csd-2466023')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
