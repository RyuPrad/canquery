-- Migration 028: Canonicalize Whitehorse (YT), St. John's (NL), Charlottetown (PE),
-- Regina (SK), Windsor (ON), Kingston (ON), Red Deer (AB), Kamloops (BC),
-- Nanaimo (BC), and Abbotsford (BC) in the 2021 Statistics Canada hierarchy.

-- Free up conflicting CD slugs prior to re-slugging CSDs
UPDATE places SET slug = 'nanaimo-region-bc' WHERE id = 'sgc-cd-5921' AND slug = 'nanaimo-bc';
UPDATE places SET slug = 'st-johns-nl' WHERE id = 'sgc-csd-1001519' AND slug = 'st-john-s-nl';

DELETE FROM place_aliases
WHERE slug IN (
    'whitehorse-yt',
    'st-johns-nl',
    'st-john-s-nl',
    'charlottetown-pe',
    'regina-sk',
    'windsor-on',
    'kingston-on',
    'red-deer-ab',
    'kamloops-bc',
    'nanaimo-bc',
    'abbotsford-bc',
    'whitehorse-city-yt',
    'st-johns-city-nl',
    'saint-johns-nl',
    'charlottetown-city-pe',
    'regina-city-sk',
    'windsor-city-on',
    'kingston-city-on',
    'red-deer-city-ab',
    'kamloops-city-bc',
    'nanaimo-city-bc',
    'abbotsford-city-bc'
);

-- Provinces / Territories
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-pr-60', 'yukon', 'territory', 'Yukon', 'Yukon', 'Territory', 'Territoire', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-10', 'newfoundland-and-labrador', 'province', 'Newfoundland and Labrador', 'Terre-Neuve-et-Labrador', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-11', 'prince-edward-island', 'province', 'Prince Edward Island', 'Île-du-Prince-Édouard', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-47', 'saskatchewan', 'province', 'Saskatchewan', 'Saskatchewan', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-48', 'alberta', 'province', 'Alberta', 'Alberta', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-59', 'british-columbia', 'province', 'British Columbia', 'Colombie-Britannique', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false)
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
    ('sgc-cd-6001', 'yukon-cd-yt', 'region', 'Yukon', 'Yukon', 'Census division', 'Division de recensement', 'sgc-pr-60', NULL, NULL, NULL, true, false),
    ('sgc-cd-1001', 'division-no-1-nl', 'region', 'Division No. 1', 'Division No. 1', 'Census division', 'Division de recensement', 'sgc-pr-10', NULL, NULL, NULL, true, false),
    ('sgc-cd-1102', 'queens-pe', 'region', 'Queens', 'Queens', 'County', 'Comté', 'sgc-pr-11', NULL, NULL, NULL, true, false),
    ('sgc-cd-4706', 'division-no-6-sk', 'region', 'Division No. 6', 'Division No. 6', 'Census division', 'Division de recensement', 'sgc-pr-47', NULL, NULL, NULL, true, false),
    ('sgc-cd-3537', 'essex-county-on', 'region', 'Essex', 'Essex', 'County', 'Comté', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-3510', 'frontenac-county-on', 'region', 'Frontenac', 'Frontenac', 'County', 'Comté', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-4808', 'division-no-8-ab', 'region', 'Division No. 8', 'Division No. 8', 'Census division', 'Division de recensement', 'sgc-pr-48', NULL, NULL, NULL, true, false),
    ('sgc-cd-5933', 'thompson-nicola-bc', 'region', 'Thompson-Nicola', 'Thompson-Nicola', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-5921', 'nanaimo-region-bc', 'region', 'Nanaimo', 'Nanaimo', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-5909', 'fraser-valley-bc', 'region', 'Fraser Valley', 'Fraser Valley', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false)
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

-- Featured Municipalities / Census Subdivisions
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-csd-6001009', 'whitehorse-yt', 'municipality', 'Whitehorse', 'Whitehorse', 'City', 'Ville', 'sgc-cd-6001', 60.7212, -135.0568, 10, true, true),
    ('sgc-csd-1001519', 'st-johns-nl', 'municipality', 'St. John''s', 'St. John''s', 'City', 'Ville', 'sgc-cd-1001', 47.5615, -52.7126, 10, true, true),
    ('sgc-csd-1102075', 'charlottetown-pe', 'municipality', 'Charlottetown', 'Charlottetown', 'City', 'Ville', 'sgc-cd-1102', 46.2382, -63.1311, 10, true, true),
    ('sgc-csd-4706027', 'regina-sk', 'municipality', 'Regina', 'Regina', 'City', 'Ville', 'sgc-cd-4706', 50.4452, -104.6189, 10, true, true),
    ('sgc-csd-3537039', 'windsor-on', 'municipality', 'Windsor', 'Windsor', 'City', 'Ville', 'sgc-cd-3537', 42.3149, -83.0364, 10, true, true),
    ('sgc-csd-3510010', 'kingston-on', 'municipality', 'Kingston', 'Kingston', 'City', 'Ville', 'sgc-cd-3510', 44.2312, -76.4860, 10, true, true),
    ('sgc-csd-4808011', 'red-deer-ab', 'municipality', 'Red Deer', 'Red Deer', 'City', 'Ville', 'sgc-cd-4808', 52.2690, -113.8116, 10, true, true),
    ('sgc-csd-5933042', 'kamloops-bc', 'municipality', 'Kamloops', 'Kamloops', 'City', 'Ville', 'sgc-cd-5933', 50.6745, -120.3273, 10, true, true),
    ('sgc-csd-5921007', 'nanaimo-bc', 'municipality', 'Nanaimo', 'Nanaimo', 'City', 'Ville', 'sgc-cd-5921', 49.1659, -123.9401, 10, true, true),
    ('sgc-csd-5909052', 'abbotsford-bc', 'municipality', 'Abbotsford', 'Abbotsford', 'City', 'Ville', 'sgc-cd-5909', 49.0504, -122.3045, 10, true, true)
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
    featured = true,
    updated_at = now();

-- Primary SGC Place Identifiers
INSERT INTO place_identifiers (place_id, scheme, vintage, value) VALUES
    ('sgc-pr-60', 'sgc-pr', '2021', '60'),
    ('sgc-pr-10', 'sgc-pr', '2021', '10'),
    ('sgc-pr-11', 'sgc-pr', '2021', '11'),
    ('sgc-pr-47', 'sgc-pr', '2021', '47'),
    ('sgc-pr-48', 'sgc-pr', '2021', '48'),
    ('sgc-pr-59', 'sgc-pr', '2021', '59'),
    ('sgc-cd-6001', 'sgc-cd', '2021', '6001'),
    ('sgc-cd-1001', 'sgc-cd', '2021', '1001'),
    ('sgc-cd-1102', 'sgc-cd', '2021', '1102'),
    ('sgc-cd-4706', 'sgc-cd', '2021', '4706'),
    ('sgc-cd-3537', 'sgc-cd', '2021', '3537'),
    ('sgc-cd-3510', 'sgc-cd', '2021', '3510'),
    ('sgc-cd-4808', 'sgc-cd', '2021', '4808'),
    ('sgc-cd-5933', 'sgc-cd', '2021', '5933'),
    ('sgc-cd-5921', 'sgc-cd', '2021', '5921'),
    ('sgc-cd-5909', 'sgc-cd', '2021', '5909'),
    ('sgc-csd-6001009', 'sgc-csd', '2021', '6001009'),
    ('sgc-csd-1001519', 'sgc-csd', '2021', '1001519'),
    ('sgc-csd-1102075', 'sgc-csd', '2021', '1102075'),
    ('sgc-csd-4706027', 'sgc-csd', '2021', '4706027'),
    ('sgc-csd-3537039', 'sgc-csd', '2021', '3537039'),
    ('sgc-csd-3510010', 'sgc-csd', '2021', '3510010'),
    ('sgc-csd-4808011', 'sgc-csd', '2021', '4808011'),
    ('sgc-csd-5933042', 'sgc-csd', '2021', '5933042'),
    ('sgc-csd-5921007', 'sgc-csd', '2021', '5921007'),
    ('sgc-csd-5909052', 'sgc-csd', '2021', '5909052')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Durable Aliases
INSERT INTO place_aliases (slug, place_id) VALUES
    ('whitehorse-city-yt', 'sgc-csd-6001009'),
    ('st-johns-city-nl', 'sgc-csd-1001519'),
    ('st-john-s-nl', 'sgc-csd-1001519'),
    ('saint-johns-nl', 'sgc-csd-1001519'),
    ('charlottetown-city-pe', 'sgc-csd-1102075'),
    ('regina-city-sk', 'sgc-csd-4706027'),
    ('windsor-city-on', 'sgc-csd-3537039'),
    ('kingston-city-on', 'sgc-csd-3510010'),
    ('red-deer-city-ab', 'sgc-csd-4808011'),
    ('kamloops-city-bc', 'sgc-csd-5933042'),
    ('nanaimo-city-bc', 'sgc-csd-5921007'),
    ('abbotsford-city-bc', 'sgc-csd-5909052')
ON CONFLICT (slug) DO UPDATE SET
    place_id = EXCLUDED.place_id;
