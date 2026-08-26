-- Vancouver is a Statistics Canada census subdivision within the Greater
-- Vancouver census division. Seed the complete ancestry so a clean migration
-- stack can enable the source before the full SGC refresh runs.

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-pr-59', 'british-columbia', 'province',
    'British Columbia', 'Colombie-Britannique',
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
    featured = false,
    updated_at = now();

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-5915', 'greater-vancouver-bc', 'region',
    'Greater Vancouver', 'Greater Vancouver',
    'Census division', 'Division de recensement', 'sgc-pr-59',
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
    'sgc-csd-5915022', 'vancouver-bc', 'municipality',
    'Vancouver', 'Vancouver', 'City', 'Ville', 'sgc-cd-5915',
    49.2827, -123.1207, 10, true, true
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
    ('sgc-pr-59', 'sgc-pr', '2021', '59'),
    ('sgc-cd-5915', 'sgc-cd', '2021', '5915'),
    ('sgc-csd-5915022', 'sgc-csd', '2021', '5915022')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;
