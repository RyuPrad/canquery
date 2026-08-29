require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { parse } = require('csv-parse/sync');
const pool = require('../db/pool');
const { fetchPublicBuffer } = require('../services/publicJson');

const EN_URL = 'https://www.statcan.gc.ca/en/statistical-programs/document/sgc-cgt-2021-structure-eng.csv';
const FR_URL = 'https://www.statcan.gc.ca/fr/programmes-statistiques/document/sgc-cgt-2021-structure-fra.csv';
const PROVINCES = {
    '10': 'nl', '11': 'pe', '12': 'ns', '13': 'nb', '24': 'qc', '35': 'on',
    '46': 'mb', '47': 'sk', '48': 'ab', '59': 'bc', '60': 'yt', '61': 'nt', '62': 'nu'
};
const TERRITORIES = new Set(['60', '61', '62']);
const SINGLE_TIER_CITY_CSD = {
    '3506008': 'sgc-cd-3506',
    '3520005': 'sgc-cd-3520',
    '3525005': 'sgc-cd-3525',
    '2465005': 'sgc-cd-2465',
    '3553005': 'sgc-cd-3553'
};
const SINGLE_TIER_CITY_CD = new Set(['2465', '3506', '3520', '3525', '3553']);
const FEATURED_PLACE_IDS = new Set([
    'ca-on-durham',
    'sgc-cd-3521',
    'sgc-cd-3524',
    'sgc-cd-3530',
    'ca-on-oshawa',
    'sgc-csd-3518005',
    'sgc-csd-3518039',
    'sgc-csd-3518017',
    'sgc-csd-3518001',
    'sgc-csd-3518020',
    'sgc-csd-3518029',
    'sgc-csd-3518009',
    'sgc-csd-3521005',
    'sgc-csd-3521010',
    'sgc-csd-3521024',
    'sgc-csd-3524001',
    'sgc-csd-3524002',
    'sgc-csd-3524009',
    'sgc-csd-3524015',
    'sgc-cd-2465',
    'sgc-cd-3506',
    'sgc-cd-3520',
    'sgc-cd-3525',
    'sgc-cd-3553',
    'sgc-csd-1209034',
    'sgc-csd-2423027',
    'sgc-csd-2466023',
    'sgc-csd-4611040',
    'sgc-csd-4711066',
    'sgc-csd-4806016',
    'sgc-csd-4811061',
    'sgc-csd-5915004',
    'sgc-csd-5915022',
    'sgc-csd-5915025',
    'sgc-csd-5917034',
    'sgc-csd-3530013',
    'sgc-csd-3530016',
    'sgc-csd-3530010',
    'sgc-csd-3530035',
    'sgc-csd-3530020',
    'sgc-csd-3530027',
    'sgc-csd-3530004',
    'sgc-csd-3539036',
    'sgc-csd-5935010',
    'sgc-csd-1310032',
    'sgc-cd-3519',
    'sgc-csd-3519036',
    'sgc-csd-3519048',
    'sgc-csd-3519028',
    'sgc-csd-3519038',
    'sgc-csd-3519046',
    'sgc-csd-3519044',
    'sgc-csd-3519049',
    'sgc-csd-3519054',
    'sgc-csd-3519070',
    'sgc-cd-3526',
    'sgc-csd-3526043',
    'sgc-csd-3526032',
    'sgc-csd-3526053',
    'sgc-csd-3526003',
    'sgc-csd-3526011',
    'sgc-csd-3526037',
    'sgc-csd-3526047',
    'sgc-csd-3526057',
    'sgc-csd-3526065',
    'sgc-csd-3526028',
    'sgc-csd-3526021',
    'sgc-csd-3526014',
    'sgc-csd-1307022',
    'sgc-csd-3523008',
    'sgc-csd-5917021',
    'sgc-csd-3512005'
]);
const MUNICIPAL_TYPES = {
    '2423027': ['City', 'Ville'],
    '2465005': ['City', 'Ville'],
    '2466023': ['City', 'Ville'],
    '3512005': ['City', 'Ville'],
    '3514019': ['Township', 'Canton'],
    '3518005': ['Town', 'Ville'],
    '3518039': ['Township', 'Canton'],
    '3518017': ['Municipality', 'Municipalité'],
    '3518013': ['City', 'Ville'],
    '3518001': ['City', 'Ville'],
    '3518020': ['Township', 'Canton'],
    '3518029': ['Township', 'Canton'],
    '3518009': ['Town', 'Ville'],
    '3519': ['Regional municipality', 'Municipalité régionale'],
    '3519036': ['City', 'Ville'],
    '3519048': ['Town', 'Ville'],
    '3519028': ['City', 'Ville'],
    '3519038': ['City', 'Ville'],
    '3519046': ['Town', 'Ville'],
    '3519044': ['Town', 'Ville'],
    '3519049': ['Township', 'Canton'],
    '3519054': ['Town', 'Ville'],
    '3519070': ['Town', 'Ville'],
    '3521005': ['City', 'Ville'],
    '3521010': ['City', 'Ville'],
    '3521024': ['Town', 'Ville'],
    '3523008': ['City', 'Ville'],
    '3524': ['Regional municipality', 'Municipalité régionale'],
    '3524001': ['Town', 'Ville'],
    '3524002': ['City', 'Ville'],
    '3524009': ['Town', 'Ville'],
    '3524015': ['Town', 'Ville'],
    '3526': ['Regional municipality', 'Municipalité régionale'],
    '3526043': ['City', 'Ville'],
    '3526032': ['City', 'Ville'],
    '3526053': ['City', 'Ville'],
    '3526003': ['Town', 'Ville'],
    '3526011': ['City', 'Ville'],
    '3526037': ['City', 'Ville'],
    '3526047': ['Town', 'Ville'],
    '3526057': ['Town', 'Ville'],
    '3526065': ['Town', 'Ville'],
    '3526028': ['Town', 'Ville'],
    '3526021': ['Township', 'Canton'],
    '3526014': ['Township', 'Canton'],
    '3530': ['Regional municipality', 'Municipalité régionale'],
    '3530013': ['City', 'Ville'],
    '3530016': ['City', 'Ville'],
    '3530010': ['City', 'Ville'],
    '3530035': ['Township', 'Canton'],
    '3530020': ['Township', 'Canton'],
    '3530027': ['Township', 'Canton'],
    '3530004': ['Township', 'Canton'],
    '3539036': ['City', 'Ville'],
    '3553': ['City', 'Ville'],
    '3553005': ['City', 'Ville'],
    '5915022': ['City', 'Ville'],
    '5915025': ['City', 'Ville'],
    '5917021': ['District municipality', 'Municipalité de district'],
    '5917034': ['City', 'Ville'],
    '5935010': ['City', 'Ville'],
    '4806016': ['City', 'Ville'],
    '4811061': ['City', 'Ville'],
    '4611040': ['City', 'Ville'],
    '4711066': ['City', 'Ville'],
    '1209034': ['Regional municipality', 'Municipalité régionale'],
    '1307019': ['Parish', 'Paroisse'],
    '1307022': ['City', 'Cité'],
    '1310032': ['City', 'Ville'],
    '5915004': ['City', 'Ville']
};
const PLACE_VIEWPORTS = {
    '2423027': [46.8139, -71.208, 10],
    '2465': [45.6066, -73.7124, 10],
    '2466023': [45.5019, -73.5674, 10],
    '3506': [45.4215, -75.6972, 9],
    '3512005': [44.1628, -77.3832, 10],
    '3525': [43.2557, -79.8711, 9],
    '3518': [44.0569, -78.8570, 9],
    '3518013': [43.8971, -78.8658, 11],
    '3519': [44.0000, -79.4667, 9],
    '3519036': [43.8561, -79.3370, 10],
    '3519048': [44.0592, -79.4613, 10],
    '3519028': [43.8563, -79.5085, 10],
    '3519038': [43.8828, -79.4403, 10],
    '3519046': [44.0000, -79.4667, 10],
    '3519044': [43.9708, -79.2514, 9],
    '3519049': [43.9500, -79.5833, 9],
    '3519054': [44.1333, -79.4500, 9],
    '3519070': [44.3000, -79.4333, 9],
    '3520': [43.6532, -79.3832, 10],
    '3521': [43.7500, -79.7800, 9],
    '3521005': [43.5890, -79.6440, 10],
    '3521010': [43.7315, -79.7624, 10],
    '3521024': [43.8668, -79.8670, 9],
    '3523008': [43.5448, -80.2482, 10],
    '3524': [43.4900, -79.8800, 9],
    '3524001': [43.4675, -79.6877, 10],
    '3524002': [43.3255, -79.7990, 10],
    '3524009': [43.5183, -79.8774, 10],
    '3524015': [43.6300, -79.9500, 9],
    '3526': [43.0600, -79.3100, 9],
    '3526043': [43.0896, -79.0849, 10],
    '3526032': [42.9922, -79.2483, 10],
    '3526053': [43.1594, -79.2469, 10],
    '3526003': [42.9000, -78.9333, 9],
    '3526011': [42.8833, -79.2500, 10],
    '3526037': [43.1167, -79.2000, 10],
    '3526047': [43.2553, -79.0772, 10],
    '3526057': [43.1667, -79.4333, 9],
    '3526065': [43.1931, -79.5600, 10],
    '3526028': [43.0500, -79.3333, 9],
    '3526021': [43.0833, -79.5667, 9],
    '3526014': [42.9167, -79.3667, 9],
    '3530': [43.4643, -80.5204, 9],
    '3530013': [43.4516, -80.4925, 10],
    '3530016': [43.4643, -80.5204, 10],
    '3530010': [43.3616, -80.3144, 10],
    '3530035': [43.5650, -80.5500, 9],
    '3530020': [43.4000, -80.6500, 9],
    '3530027': [43.5500, -80.7667, 9],
    '3530004': [43.3000, -80.3833, 9],
    '3539036': [42.9849, -81.2453, 9],
    '3553': [46.4900, -80.9900, 9],
    '5915022': [49.2827, -123.1207, 10],
    '5915025': [49.2488, -122.9805, 10],
    '5917034': [48.4284, -123.3656, 10],
    '5935010': [49.8880, -119.4960, 10],
    '4806016': [51.0447, -114.0719, 9],
    '4811061': [53.5461, -113.4938, 9],
    '4611040': [49.8954, -97.1385, 9],
    '4711066': [52.1332, -106.6700, 10],
    '1209034': [44.6488, -63.5752, 8],
    '1307019': [46.0878, -64.7782, 10],
    '1307022': [46.0878, -64.7782, 10],
    '1310032': [45.9636, -66.6431, 10],
    '5915004': [49.1913, -122.8490, 10],
    '5917021': [48.4841, -123.3822, 10]
};

function slugify(value) {
    return String(value || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function rowsFrom(buffer, encoding) {
    const text = new TextDecoder(encoding).decode(buffer);
    return parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

function normalize(enRows, frRows) {
    const frByCode = new Map(frRows.map(row => [String(row.Code), row]));
    const usedSlugs = new Set(['canada']);
    const places = [{
        id: 'ca', slug: 'canada', kind: 'country', nameEn: 'Canada', nameFr: 'Canada',
        typeEn: 'Country', typeFr: 'Pays', parentId: null, featured: false
    }];
    const identifiers = [{ placeId: 'ca', scheme: 'sgc', vintage: '2021', value: '01' }];
    for (const row of enRows) {
        const level = Number(row.Level);
        const code = String(row.Code || '').trim();
        if (![2, 3, 4].includes(level) || !code) continue;
        const provinceCode = code.slice(0, 2);
        const provinceAbbr = PROVINCES[provinceCode];
        if (!provinceAbbr) continue;
        const fr = frByCode.get(code) || {};
        let nameEn = String(row['Class title'] || '').trim();
        let nameFr = String(fr['Titres de classes'] || nameEn).trim();
        if (code === '3553') {
            nameEn = 'Greater Sudbury';
            nameFr = 'Grand Sudbury';
        }
        // Québec remains a distinct city subdivision under its multi-city
        // census division. Laval, Ottawa, Toronto, Hamilton and Greater Sudbury are each
        // single-tier census divisions with a matching city subdivision;
        // preserve both official identifiers while exposing one city.
        if (level === 4 && SINGLE_TIER_CITY_CSD[code]) {
            const placeId = SINGLE_TIER_CITY_CSD[code];
            identifiers.push({ placeId, scheme: 'sgc-csd', vintage: '2021', value: code });
            continue;
        }
        let id, kind, parentId, scheme, typeEn, typeFr, baseSlug;
        if (level === 2) {
            id = 'sgc-pr-' + code;
            kind = TERRITORIES.has(code) ? 'territory' : 'province';
            parentId = 'ca';
            scheme = 'sgc-pr';
            typeEn = kind === 'territory' ? 'Territory' : 'Province';
            typeFr = kind === 'territory' ? 'Territoire' : 'Province';
            baseSlug = slugify(nameEn);
        } else if (level === 3) {
            id = code === '3518' ? 'ca-on-durham' : 'sgc-cd-' + code;
            kind = SINGLE_TIER_CITY_CD.has(code) ? 'municipality' : 'region';
            parentId = code.slice(0, 2) === '35' ? 'ca-on' : 'sgc-pr-' + code.slice(0, 2);
            scheme = 'sgc-cd';
            typeEn = SINGLE_TIER_CITY_CD.has(code) ? 'City' : 'Census division';
            typeFr = SINGLE_TIER_CITY_CD.has(code) ? 'Ville' : 'Division de recensement';
            baseSlug = slugify(nameEn) + '-' + provinceAbbr;
        } else {
            id = code === '3518013' ? 'ca-on-oshawa' : 'sgc-csd-' + code;
            kind = 'municipality';
            parentId = code.slice(0, 4) === '3518' ? 'ca-on-durham' : 'sgc-cd-' + code.slice(0, 4);
            scheme = 'sgc-csd';
            typeEn = 'Municipality';
            typeFr = 'Municipalité';
            baseSlug = slugify(nameEn) + '-' + provinceAbbr;
        }
        if (code === '35') id = 'ca-on';
        if (code === '35') parentId = 'ca';
        if (code === '35') baseSlug = 'ontario';
        let slug = baseSlug;
        if (code === '1209') slug = 'halifax-region-ns';
        if (code === '1209034') slug = 'halifax-ns';
        if (code === '1307019') slug = 'moncton-parish-nb';
        if (code === '1307022') slug = 'moncton-nb';
        if (code === '3518') slug = 'durham-on';
        if (code === '2423') slug = 'quebec-region-qc';
        if (code === '2423027') slug = 'quebec-qc';
        if (code === '2466') slug = 'montreal-region-qc';
        if (code === '2466023') slug = 'montreal-qc';
        if (code === '2465') slug = 'laval-qc';
        if (code === '3506') slug = 'ottawa-on';
        if (code === '3514019') slug = 'hamilton-township-on';
        if (code === '3519') slug = 'york-region-on';
        if (code === '3520') slug = 'toronto-on';
        if (code === '3524') slug = 'halton-region-on';
        if (code === '3525') slug = 'hamilton-on';
        if (code === '3526') slug = 'niagara-region-on';
        if (code === '3530') slug = 'waterloo-region-on';
        if (code === '3530016') slug = 'waterloo-on';
        if (code === '3553') slug = 'greater-sudbury-on';
        if (code === '3518013') slug = 'oshawa-on';
        if (code === '3518') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (code === '3519') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (code === '3521') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (code === '3524') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (code === '3526') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (code === '3530') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (MUNICIPAL_TYPES[code]) [typeEn, typeFr] = MUNICIPAL_TYPES[code];
        if (usedSlugs.has(slug)) slug += '-' + code;
        usedSlugs.add(slug);
        const viewport = PLACE_VIEWPORTS[code] || [];
        places.push({
            id, slug, kind, nameEn, nameFr, typeEn, typeFr, parentId,
            featured: FEATURED_PLACE_IDS.has(id),
            latitude: viewport[0] ?? null,
            longitude: viewport[1] ?? null,
            defaultZoom: viewport[2] ?? null
        });
        identifiers.push({ placeId: id, scheme, vintage: '2021', value: code });
    }
    return { places, identifiers };
}

async function preflightPlaceChanges(client, places) {
    const desiredById = new Map();
    const desiredBySlug = new Map();
    for (const place of places) {
        if (desiredById.has(place.id)) throw new Error('duplicate desired place id: ' + place.id);
        if (desiredBySlug.has(place.slug)) {
            throw new Error('duplicate desired place slug: ' + place.slug);
        }
        desiredById.set(place.id, place);
        desiredBySlug.set(place.slug, place.id);
    }
    const ids = Array.from(desiredById.keys());
    const slugs = Array.from(desiredBySlug.keys());
    const existingResult = await client.query(`
        SELECT id, slug, name_en FROM places WHERE id = ANY($1::text[])
    `, [ids]);
    const canonicalResult = await client.query(`
        SELECT id, slug FROM places WHERE slug = ANY($1::text[])
    `, [slugs]);
    for (const row of canonicalResult.rows) {
        const desiredOwner = desiredBySlug.get(row.slug);
        if (desiredOwner !== row.id) {
            throw new Error('desired place slug is already canonical for another place: ' + row.slug);
        }
    }
    const aliases = [];
    let nameChanges = 0;
    let slugChanges = 0;
    for (const row of existingResult.rows) {
        const desired = desiredById.get(row.id);
        if (row.name_en !== desired.nameEn) nameChanges += 1;
        if (row.slug === desired.slug) continue;
        if (desiredBySlug.has(row.slug) && desiredBySlug.get(row.slug) !== row.id) {
            throw new Error('former place slug is becoming canonical for another place: ' + row.slug);
        }
        slugChanges += 1;
        aliases.push({ slug: row.slug, placeId: row.id });
    }
    if (aliases.length) {
        const aliasResult = await client.query(`
            SELECT slug, place_id FROM place_aliases WHERE slug = ANY($1::text[])
        `, [aliases.map(item => item.slug)]);
        const wanted = new Map(aliases.map(item => [item.slug, item.placeId]));
        for (const row of aliasResult.rows) {
            if (wanted.get(row.slug) !== row.place_id) {
                throw new Error('former place slug is already an alias for another place: ' + row.slug);
            }
        }
    }
    return { aliases, nameChanges, slugChanges, aliasConflicts: 0 };
}

async function upsert({ places, identifiers }, dryRun, dbPool = pool) {
    const kindOrder = { country: 0, province: 1, territory: 1, region: 2, municipality: 3 };
    const orderedPlaces = [...places].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const changes = await preflightPlaceChanges(client, orderedPlaces);
        if (dryRun) {
            await client.query('ROLLBACK');
            return changes;
        }
        for (let index = 0; index < changes.aliases.length; index += 500) {
            const chunk = changes.aliases.slice(index, index + 500);
            const values = [];
            const tuples = chunk.map((alias, i) => {
                const p = i * 2 + 1;
                values.push(alias.slug, alias.placeId);
                return `($${p},$${p + 1})`;
            });
            const inserted = await client.query(`
                INSERT INTO place_aliases (slug, place_id)
                VALUES ${tuples.join(',')}
                ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id
                WHERE place_aliases.place_id = EXCLUDED.place_id
            `, values);
            if (inserted.rowCount !== chunk.length) {
                throw new Error('place alias ownership changed during refresh');
            }
        }
        for (let index = 0; index < orderedPlaces.length; index += 250) {
            const chunk = orderedPlaces.slice(index, index + 250);
            const values = [];
            const tuples = chunk.map((place, i) => {
                const p = i * 13 + 1;
                values.push(
                    place.id, place.slug, place.kind, place.nameEn, place.nameFr,
                    place.typeEn, place.typeFr, place.parentId, place.latitude,
                    place.longitude, place.defaultZoom, true, place.featured === true
                );
                return `($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11},$${p + 12})`;
            });
            await client.query(`
                INSERT INTO places (
                    id, slug, kind, name_en, name_fr, type_en, type_fr,
                    parent_id, latitude, longitude, default_zoom, enabled, featured
                )
                VALUES ${tuples.join(',')}
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
                    featured = EXCLUDED.featured,
                    updated_at = now()
            `, values);
        }
        for (let index = 0; index < identifiers.length; index += 500) {
            const chunk = identifiers.slice(index, index + 500);
            const values = [];
            const tuples = chunk.map((identifier, i) => {
                const p = i * 4 + 1;
                values.push(identifier.placeId, identifier.scheme, identifier.vintage, identifier.value);
                return `($${p},$${p + 1},$${p + 2},$${p + 3})`;
            });
            await client.query(`
                INSERT INTO place_identifiers (place_id, scheme, vintage, value)
                VALUES ${tuples.join(',')}
                ON CONFLICT (scheme, vintage, value) DO UPDATE SET place_id = EXCLUDED.place_id
            `, values);
        }
        await client.query('COMMIT');
        return changes;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    const [en, fr] = await Promise.all([
        fetchPublicBuffer(EN_URL, { maxBytes: 2 * 1024 * 1024 }),
        fetchPublicBuffer(FR_URL, { maxBytes: 2 * 1024 * 1024 })
    ]);
    const normalized = normalize(rowsFrom(en, 'windows-1252'), rowsFrom(fr, 'windows-1252'));
    const changes = await upsert(normalized, process.argv.includes('--dry-run'));
    console.log(JSON.stringify({
        places: normalized.places.length,
        identifiers: normalized.identifiers.length,
        name_changes: changes.nameChanges,
        slug_changes: changes.slugChanges,
        aliases_to_add: changes.aliases.length,
        alias_conflicts: changes.aliasConflicts
    }));
}

if (require.main === module) {
    main()
        .then(() => pool.end())
        .then(() => process.exit(0))
        .catch(async error => {
            console.error(error);
            try { await pool.end(); } catch {}
            process.exit(1);
        });
}

module.exports = { normalize, slugify, rowsFrom, preflightPlaceChanges, upsert, main };
