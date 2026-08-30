-- Migration 029: recover the v33/v34 canonical place state, repair known
-- Unicode damage, and add the v35 Northwest Territories / BC / Quebec wave.
-- Migrations 001-028 are intentionally immutable; this migration is additive
-- and safe on both fresh databases and partially deployed v34 databases.

DELETE FROM place_aliases
WHERE slug IN (
    'coquitlam-bc',
    'prince-george-bc',
    'new-westminster-bc',
    'port-moody-bc',
    'squamish-bc',
    'maple-ridge-bc',
    'port-coquitlam-bc',
    'saint-hyacinthe-qc',
    'coquitlam-city-bc',
    'prince-george-city-bc',
    'new-westminster-city-bc',
    'port-moody-city-bc',
    'squamish-district-bc',
    'maple-ridge-city-bc',
    'port-coquitlam-city-bc',
    'saint-hyacinthe-city-qc'
);

-- Provinces and territory required by the new ancestry. These upserts also
-- repair the most visible mojibake left by an earlier UTF-8 decode attempt.
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-pr-24', 'quebec', 'province', 'Quebec', 'Québec', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
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

-- Census divisions / regional districts for the v35 municipalities.
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-cd-2454', 'les-maskoutains-qc', 'region', 'Les Maskoutains', 'Les Maskoutains', 'Census division', 'Division de recensement', 'sgc-pr-24', NULL, NULL, NULL, true, false),
    ('sgc-cd-5915', 'greater-vancouver-bc', 'region', 'Greater Vancouver', 'Greater Vancouver', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-5931', 'squamish-lillooet-bc', 'region', 'Squamish-Lillooet', 'Squamish-Lillooet', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-5953', 'fraser-fort-george-bc', 'region', 'Fraser-Fort George', 'Fraser-Fort George', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false)
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

-- Featured v35 municipalities. The Northwest Territories source is assigned
-- to sgc-pr-61 directly and does not make the territory a featured destination.
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-csd-5915034', 'coquitlam-bc', 'municipality', 'Coquitlam', 'Coquitlam', 'City', 'Ville', 'sgc-cd-5915', 49.2838, -122.7932, 10, true, true),
    ('sgc-csd-5953023', 'prince-george-bc', 'municipality', 'Prince George', 'Prince George', 'City', 'Ville', 'sgc-cd-5953', 53.9171, -122.7497, 10, true, true),
    ('sgc-csd-5915029', 'new-westminster-bc', 'municipality', 'New Westminster', 'New Westminster', 'City', 'Ville', 'sgc-cd-5915', 49.2057, -122.9110, 11, true, true),
    ('sgc-csd-5915043', 'port-moody-bc', 'municipality', 'Port Moody', 'Port Moody', 'City', 'Ville', 'sgc-cd-5915', 49.2838, -122.8317, 11, true, true),
    ('sgc-csd-5931006', 'squamish-bc', 'municipality', 'Squamish', 'Squamish', 'District municipality', 'Municipalité de district', 'sgc-cd-5931', 49.7016, -123.1558, 10, true, true),
    ('sgc-csd-5915075', 'maple-ridge-bc', 'municipality', 'Maple Ridge', 'Maple Ridge', 'City', 'Ville', 'sgc-cd-5915', 49.2193, -122.5984, 10, true, true),
    ('sgc-csd-5915039', 'port-coquitlam-bc', 'municipality', 'Port Coquitlam', 'Port Coquitlam', 'City', 'Ville', 'sgc-cd-5915', 49.2628, -122.7811, 11, true, true),
    ('sgc-csd-2454048', 'saint-hyacinthe-qc', 'municipality', 'Saint-Hyacinthe', 'Saint-Hyacinthe', 'City', 'Ville', 'sgc-cd-2454', 45.6307, -72.9569, 10, true, true)
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

-- Explicitly repair known accented canonical rows before sync:places performs
-- the complete Windows-1252-backed SGC reconciliation.
UPDATE places SET name_en = 'Quebec', name_fr = 'Québec', updated_at = now()
WHERE id = 'sgc-pr-24';
UPDATE places SET name_en = 'Nova Scotia', name_fr = 'Nouvelle-Écosse', updated_at = now()
WHERE id = 'sgc-pr-12';
UPDATE places SET name_en = 'Prince Edward Island', name_fr = 'Île-du-Prince-Édouard', updated_at = now()
WHERE id = 'sgc-pr-11';
UPDATE places SET name_en = 'Newfoundland and Labrador', name_fr = 'Terre-Neuve-et-Labrador', updated_at = now()
WHERE id = 'sgc-pr-10';
UPDATE places SET name_en = 'Montréal', name_fr = 'Montréal', updated_at = now()
WHERE id = 'sgc-cd-2466';
UPDATE places SET name_en = 'Montréal', name_fr = 'Montréal', updated_at = now()
WHERE id = 'sgc-csd-2466023';
UPDATE places SET name_en = 'Québec', name_fr = 'Québec', updated_at = now()
WHERE id = 'sgc-csd-2423027';
UPDATE places SET name_en = 'Trois-Rivières', name_fr = 'Trois-Rivières', updated_at = now()
WHERE id = 'sgc-csd-2437067';
UPDATE places SET name_en = 'Lévis', name_fr = 'Lévis', updated_at = now()
WHERE id = 'sgc-csd-2425213';

INSERT INTO place_identifiers (place_id, scheme, vintage, value) VALUES
    ('sgc-pr-24', 'sgc-pr', '2021', '24'),
    ('sgc-pr-59', 'sgc-pr', '2021', '59'),
    ('sgc-pr-61', 'sgc-pr', '2021', '61'),
    ('sgc-cd-2454', 'sgc-cd', '2021', '2454'),
    ('sgc-cd-5915', 'sgc-cd', '2021', '5915'),
    ('sgc-cd-5931', 'sgc-cd', '2021', '5931'),
    ('sgc-cd-5953', 'sgc-cd', '2021', '5953'),
    ('sgc-csd-5915034', 'sgc-csd', '2021', '5915034'),
    ('sgc-csd-5953023', 'sgc-csd', '2021', '5953023'),
    ('sgc-csd-5915029', 'sgc-csd', '2021', '5915029'),
    ('sgc-csd-5915043', 'sgc-csd', '2021', '5915043'),
    ('sgc-csd-5931006', 'sgc-csd', '2021', '5931006'),
    ('sgc-csd-5915075', 'sgc-csd', '2021', '5915075'),
    ('sgc-csd-5915039', 'sgc-csd', '2021', '5915039'),
    ('sgc-csd-2454048', 'sgc-csd', '2021', '2454048')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

INSERT INTO place_aliases (slug, place_id) VALUES
    ('coquitlam-city-bc', 'sgc-csd-5915034'),
    ('prince-george-city-bc', 'sgc-csd-5953023'),
    ('new-westminster-city-bc', 'sgc-csd-5915029'),
    ('port-moody-city-bc', 'sgc-csd-5915043'),
    ('squamish-district-bc', 'sgc-csd-5931006'),
    ('maple-ridge-city-bc', 'sgc-csd-5915075'),
    ('port-coquitlam-city-bc', 'sgc-csd-5915039'),
    ('saint-hyacinthe-city-qc', 'sgc-csd-2454048')
ON CONFLICT (slug) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Reassert durable v33/v34 aliases so a partial earlier rollout converges to
-- the same state as a fresh installation.
INSERT INTO place_aliases (slug, place_id) VALUES
    ('gatineau-city-qc', 'sgc-csd-2481017'),
    ('trois-rivieres-city-qc', 'sgc-csd-2437067'),
    ('repentigny-city-qc', 'sgc-csd-2460013'),
    ('longueuil-city-qc', 'sgc-csd-2458227'),
    ('saguenay-city-qc', 'sgc-csd-2494068'),
    ('rimouski-city-qc', 'sgc-csd-2410043'),
    ('shawinigan-city-qc', 'sgc-csd-2436033'),
    ('levis-city-qc', 'sgc-csd-2425213'),
    ('sherbrooke-city-qc', 'sgc-csd-2443027'),
    ('saint-john-city-nb', 'sgc-csd-1301006'),
    ('whitehorse-city-yt', 'sgc-csd-6001009'),
    ('st-johns-city-nl', 'sgc-csd-1001519'),
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
