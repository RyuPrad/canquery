-- Seed the complete Statistics Canada 2021 ancestry for Edmonton and Winnipeg
-- so both sources can launch before the next full SGC refresh.

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    (
        'sgc-pr-46', 'manitoba', 'province',
        'Manitoba', 'Manitoba', 'Province', 'Province', 'ca',
        NULL, NULL, NULL, true, false
    ),
    (
        'sgc-cd-4611', 'division-no-11-mb', 'region',
        'Division No. 11', 'Division No. 11',
        'Census division', 'Division de recensement', 'sgc-pr-46',
        NULL, NULL, NULL, true, false
    ),
    (
        'sgc-csd-4611040', 'winnipeg-mb', 'municipality',
        'Winnipeg', 'Winnipeg', 'City', 'Ville', 'sgc-cd-4611',
        49.8954, -97.1385, 9, true, true
    ),
    (
        'sgc-pr-48', 'alberta', 'province',
        'Alberta', 'Alberta', 'Province', 'Province', 'ca',
        NULL, NULL, NULL, true, false
    ),
    (
        'sgc-cd-4811', 'division-no-11-ab', 'region',
        'Division No. 11', 'Division No. 11',
        'Census division', 'Division de recensement', 'sgc-pr-48',
        NULL, NULL, NULL, true, false
    ),
    (
        'sgc-csd-4811061', 'edmonton-ab', 'municipality',
        'Edmonton', 'Edmonton', 'City', 'Ville', 'sgc-cd-4811',
        53.5461, -113.4938, 9, true, true
    )
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

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-pr-46', 'sgc-pr', '2021', '46'),
    ('sgc-cd-4611', 'sgc-cd', '2021', '4611'),
    ('sgc-csd-4611040', 'sgc-csd', '2021', '4611040'),
    ('sgc-pr-48', 'sgc-pr', '2021', '48'),
    ('sgc-cd-4811', 'sgc-cd', '2021', '4811'),
    ('sgc-csd-4811061', 'sgc-csd', '2021', '4811061')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;
