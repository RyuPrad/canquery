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
const FEATURED_PLACE_IDS = new Set([
    'sgc-cd-3520',
    'ca-on-durham',
    'sgc-csd-3518005',
    'sgc-csd-3518039',
    'sgc-csd-3518017',
    'ca-on-oshawa',
    'sgc-csd-3518001',
    'sgc-csd-3518020',
    'sgc-csd-3518029',
    'sgc-csd-3518009'
]);
const DURHAM_TYPES = {
    '3518005': ['Town', 'Ville'],
    '3518039': ['Township', 'Canton'],
    '3518017': ['Municipality', 'Municipalité'],
    '3518013': ['City', 'Ville'],
    '3518001': ['City', 'Ville'],
    '3518020': ['Township', 'Canton'],
    '3518029': ['Township', 'Canton'],
    '3518009': ['Town', 'Ville']
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
        const nameEn = String(row['Class title'] || '').trim();
        const nameFr = String(fr['Titres de classes'] || nameEn).trim();
        // Toronto's census division and census subdivision describe the same
        // single-tier city. Keep the CSD identifier, but do not create a second
        // user-facing place.
        if (level === 4 && code === '3520005') {
            identifiers.push({ placeId: 'sgc-cd-3520', scheme: 'sgc-csd', vintage: '2021', value: code });
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
            kind = code === '3520' ? 'municipality' : 'region';
            parentId = code.slice(0, 2) === '35' ? 'ca-on' : 'sgc-pr-' + code.slice(0, 2);
            scheme = 'sgc-cd';
            typeEn = code === '3520' ? 'City' : 'Census division';
            typeFr = code === '3520' ? 'Ville' : 'Division de recensement';
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
        if (code === '3518') slug = 'durham-on';
        if (code === '3520') slug = 'toronto-on';
        if (code === '3518013') slug = 'oshawa-on';
        if (code === '3518') {
            typeEn = 'Regional municipality';
            typeFr = 'Municipalité régionale';
        }
        if (DURHAM_TYPES[code]) [typeEn, typeFr] = DURHAM_TYPES[code];
        if (usedSlugs.has(slug)) slug += '-' + code;
        usedSlugs.add(slug);
        places.push({
            id, slug, kind, nameEn, nameFr, typeEn, typeFr, parentId,
            featured: FEATURED_PLACE_IDS.has(id),
            latitude: code === '3520' ? 43.6532 : null,
            longitude: code === '3520' ? -79.3832 : null,
            defaultZoom: code === '3520' ? 10 : null
        });
        identifiers.push({ placeId: id, scheme, vintage: '2021', value: code });
    }
    return { places, identifiers };
}

async function upsert({ places, identifiers }, dryRun) {
    if (dryRun) return;
    const kindOrder = { country: 0, province: 1, territory: 1, region: 2, municipality: 3 };
    const orderedPlaces = [...places].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
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
    const normalized = normalize(rowsFrom(en, 'utf-8'), rowsFrom(fr, 'windows-1252'));
    await upsert(normalized, process.argv.includes('--dry-run'));
    console.log(JSON.stringify({ places: normalized.places.length, identifiers: normalized.identifiers.length }));
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

module.exports = { normalize, slugify, rowsFrom, upsert, main };
