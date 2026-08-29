-- Migration 026: Canonicalize Lethbridge (AB), Medicine Hat (AB), Airdrie (AB),
-- Canmore (AB), Penticton (BC), Langley City (BC), Huron County (ON), and Cumberland County (NS)
-- in the 2021 Statistics Canada hierarchy.

DELETE FROM place_aliases
WHERE slug IN (
    'lethbridge-ab',
    'medicine-hat-ab',
    'airdrie-ab',
    'canmore-ab',
    'penticton-bc',
    'langley-bc',
    'huron-on',
    'huron-county-on',
    'cumberland-ns',
    'cumberland-county-ns',
    'langley-city-bc',
    'canmore-town-ab',
    'penticton-city-bc',
    'lethbridge-city-ab',
    'medicine-hat-city-ab',
    'airdrie-city-ab'
);

-- Provinces
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-pr-48', 'alberta', 'province', 'Alberta', 'Alberta', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-59', 'british-columbia', 'province', 'British Columbia', 'Colombie-Britannique', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('ca-on', 'ontario', 'province', 'Ontario', 'Ontario', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-12', 'nova-scotia', 'province', 'Nova Scotia', 'Nouvelle-Écosse', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false)
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

-- Census Divisions / Regions / Counties
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-cd-4802', 'division-no-2-ab', 'region', 'Division No.  2', 'Division No.  2', 'Census division', 'Division de recensement', 'sgc-pr-48', NULL, NULL, NULL, true, false),
    ('sgc-cd-4801', 'division-no-1-ab', 'region', 'Division No.  1', 'Division No.  1', 'Census division', 'Division de recensement', 'sgc-pr-48', NULL, NULL, NULL, true, false),
    ('sgc-cd-4806', 'division-no-6-ab', 'region', 'Division No.  6', 'Division No.  6', 'Census division', 'Division de recensement', 'sgc-pr-48', NULL, NULL, NULL, true, false),
    ('sgc-cd-4815', 'division-no-15-ab', 'region', 'Division No. 15', 'Division No. 15', 'Census division', 'Division de recensement', 'sgc-pr-48', NULL, NULL, NULL, true, false),
    ('sgc-cd-5907', 'okanagan-similkameen-bc', 'region', 'Okanagan-Similkameen', 'Okanagan-Similkameen', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-5915', 'greater-vancouver-bc', 'region', 'Greater Vancouver', 'Greater Vancouver', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-3540', 'huron-county-on', 'region', 'Huron', 'Huron', 'County', 'Comté', 'ca-on', 43.5833, -81.5000, 9, true, true),
    ('sgc-cd-1211', 'cumberland-county-ns', 'region', 'Cumberland', 'Cumberland', 'County', 'Comté', 'sgc-pr-12', 45.7500, -64.0000, 8, true, true)
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
    ('sgc-csd-4802012', 'lethbridge-ab', 'municipality', 'Lethbridge', 'Lethbridge', 'City', 'Ville', 'sgc-cd-4802', 49.6956, -112.8451, 10, true, true),
    ('sgc-csd-4801006', 'medicine-hat-ab', 'municipality', 'Medicine Hat', 'Medicine Hat', 'City', 'Ville', 'sgc-cd-4801', 50.0417, -110.6775, 10, true, true),
    ('sgc-csd-4806021', 'airdrie-ab', 'municipality', 'Airdrie', 'Airdrie', 'City', 'Ville', 'sgc-cd-4806', 51.2917, -114.0144, 10, true, true),
    ('sgc-csd-4815023', 'canmore-ab', 'municipality', 'Canmore', 'Canmore', 'Town', 'Ville', 'sgc-cd-4815', 51.0890, -115.3590, 10, true, true),
    ('sgc-csd-5907041', 'penticton-bc', 'municipality', 'Penticton', 'Penticton', 'City', 'Ville', 'sgc-cd-5907', 49.4991, -119.5937, 10, true, true),
    ('sgc-csd-5915001', 'langley-bc', 'municipality', 'Langley', 'Langley', 'City', 'Ville', 'sgc-cd-5915', 49.1044, -122.6580, 10, true, true)
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
    ('sgc-pr-48', 'sgc-pr', '2021', '48'),
    ('sgc-pr-12', 'sgc-pr', '2021', '12'),
    ('sgc-cd-4802', 'sgc-cd', '2021', '4802'),
    ('sgc-csd-4802012', 'sgc-csd', '2021', '4802012'),
    ('sgc-cd-4801', 'sgc-cd', '2021', '4801'),
    ('sgc-csd-4801006', 'sgc-csd', '2021', '4801006'),
    ('sgc-cd-4806', 'sgc-cd', '2021', '4806'),
    ('sgc-csd-4806021', 'sgc-csd', '2021', '4806021'),
    ('sgc-cd-4815', 'sgc-cd', '2021', '4815'),
    ('sgc-csd-4815023', 'sgc-csd', '2021', '4815023'),
    ('sgc-cd-5907', 'sgc-cd', '2021', '5907'),
    ('sgc-csd-5907041', 'sgc-csd', '2021', '5907041'),
    ('sgc-cd-5915', 'sgc-cd', '2021', '5915'),
    ('sgc-csd-5915001', 'sgc-csd', '2021', '5915001'),
    ('sgc-cd-3540', 'sgc-cd', '2021', '3540'),
    ('sgc-cd-1211', 'sgc-cd', '2021', '1211')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Durable Aliases
INSERT INTO place_aliases (slug, place_id)
VALUES
    ('huron-on', 'sgc-cd-3540'),
    ('cumberland-ns', 'sgc-cd-1211'),
    ('langley-city-bc', 'sgc-csd-5915001'),
    ('canmore-town-ab', 'sgc-csd-4815023'),
    ('penticton-city-bc', 'sgc-csd-5907041'),
    ('lethbridge-city-ab', 'sgc-csd-4802012'),
    ('medicine-hat-city-ab', 'sgc-csd-4801006'),
    ('airdrie-city-ab', 'sgc-csd-4806021')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
