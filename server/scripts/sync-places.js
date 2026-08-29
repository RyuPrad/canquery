// sync-places.js - Synchronize Canonical StatCan SGC 2021 Places Hierarchy
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const EN_URL = 'https://www.statcan.gc.ca/en/subjects/standard/sgc/2021/csv/SGC-CGT-2021-CSV-EN.zip';
const FR_URL = 'https://www.statcan.gc.ca/fr/sujets/norme/cgt/2021/csv/SGC-CGT-2021-CSV-FR.zip';

const FEATURED_PLACE_IDS = new Set([
    'ca',
    'ca-on',
    'sgc-pr-24',
    'sgc-pr-48',
    'sgc-pr-59',
    'sgc-pr-46',
    'sgc-pr-12',
    'sgc-pr-13',
    'sgc-pr-47',
    'sgc-pr-10',
    'sgc-pr-11',
    'sgc-pr-60',
    'sgc-pr-61',
    'sgc-pr-62',
    'sgc-cd-3520',
    'sgc-csd-2466023',
    'sgc-csd-2423027',
    'sgc-csd-2481017',
    'sgc-csd-2437067',
    'sgc-csd-2460013',
    'sgc-csd-2458227',
    'sgc-csd-2494068',
    'sgc-csd-2410043',
    'sgc-csd-2436033',
    'sgc-csd-2425213',
    'sgc-csd-2443027',
    'sgc-cd-2465',
    'sgc-cd-3506',
    'sgc-csd-5915022',
    'sgc-csd-4806016',
    'sgc-csd-4811061',
    'sgc-csd-4611040',
    'sgc-csd-1209034',
    'sgc-cd-3525',
    'sgc-csd-5915004',
    'ca-on-oshawa',
    'sgc-csd-3518005',
    'sgc-csd-3518001',
    'sgc-csd-3518009',
    'ca-on-durham',
    'sgc-csd-3521005',
    'sgc-csd-3521010',
    'sgc-cd-3521',
    'sgc-csd-5917034',
    'sgc-cd-3530',
    'sgc-csd-3530013',
    'sgc-csd-3530010',
    'sgc-csd-3530016',
    'sgc-csd-3539036',
    'sgc-csd-5935010',
    'sgc-csd-1310032',
    'sgc-csd-3524002',
    'sgc-csd-3524001',
    'sgc-csd-3524009',
    'sgc-cd-3553',
    'sgc-csd-5915025',
    'sgc-csd-4711066',
    'sgc-csd-3519036',
    'sgc-csd-3519048',
    'sgc-cd-3519',
    'sgc-csd-3526043',
    'sgc-csd-3526032',
    'sgc-csd-1307022',
    'sgc-csd-3523008',
    'sgc-csd-5917021',
    'sgc-csd-3512005',
    'sgc-csd-6106023',
    'sgc-csd-3543042',
    'sgc-csd-3558004',
    'sgc-cd-3536',
    'sgc-cd-3516',
    'sgc-csd-5907035',
    'sgc-csd-3528052',
    'sgc-csd-3528018',
    'sgc-csd-4802012',
    'sgc-csd-4801006',
    'sgc-csd-4806021',
    'sgc-csd-4815023',
    'sgc-csd-5907041',
    'sgc-csd-5915001',
    'sgc-cd-3540',
    'sgc-cd-1211',
    'sgc-csd-1301006'
]);

const MUNICIPAL_TYPES = {
    'C': { en: 'City', fr: 'Cité' },
    'CV': { en: 'City / Ville', fr: 'Cité / Ville' },
    'CY': { en: 'City', fr: 'Cité' },
    'DM': { en: 'District Municipality', fr: 'Municipalité de district' },
    'IM': { en: 'Island Municipality', fr: 'Municipalité insulaire' },
    'M': { en: 'Municipality', fr: 'Municipalité' },
    'MU': { en: 'Municipality', fr: 'Municipalité' },
    'NL': { en: 'Nisga\'a Land', fr: 'Terre Nisga\'a' },
    'NV': { en: 'Northern Village', fr: 'Village nordique' },
    'P': { en: 'Parish', fr: 'Paroisse' },
    'PE': { en: 'Parish Municipality', fr: 'Municipalité de paroisse' },
    'RGM': { en: 'Regional Municipality', fr: 'Municipalité régionale' },
    'RM': { en: 'Rural Municipality', fr: 'Municipalité rurale' },
    'RV': { en: 'Resort Village', fr: 'Village villégiature' },
    'SM': { en: 'Specialized Municipality', fr: 'Municipalité spécialisée' },
    'T': { en: 'Town', fr: 'Ville' },
    'TP': { en: 'Township', fr: 'Canton' },
    'TV': { en: 'Town / Ville', fr: 'Ville' },
    'V': { en: 'Village', fr: 'Village' },
    'VK': { en: 'Village / Cri', fr: 'Village Cri' },
    'VL': { en: 'Village', fr: 'Village' },
    'VN': { en: 'Village / Naskapi', fr: 'Village Naskapi' },
    'CC': { en: 'Chartered Community', fr: 'Collectivité constituée' },
    'HAM': { en: 'Hamlet', fr: 'Hameau' },
    'SET': { en: 'Settlement', fr: 'Établissement' },
    'SV': { en: 'Summer Village', fr: 'Village d\'été' },
    'UNO': { en: 'Unorganized', fr: 'Non organisé' },
    'NO': { en: 'Unorganized', fr: 'Non organisé' },
    'IRI': { en: 'Indian Reserve', fr: 'Réserve indienne' },
    'S-É': { en: 'Indian Settlement', fr: 'Établissement indien' },
    'IGD': { en: 'Indian Government District', fr: 'District gouvernemental indien' }
};

const PLACE_VIEWPORTS = {
    'ca': { lat: 56.1304, lng: -106.3468, zoom: 4 },
    'ca-on': { lat: 51.2538, lng: -85.3232, zoom: 5 },
    'sgc-pr-24': { lat: 52.9399, lng: -73.5491, zoom: 5 },
    'sgc-pr-48': { lat: 53.9333, lng: -116.5765, zoom: 5 },
    'sgc-pr-59': { lat: 53.7267, lng: -127.6476, zoom: 5 },
    'sgc-pr-46': { lat: 53.7609, lng: -98.8139, zoom: 5 },
    'sgc-pr-12': { lat: 44.6820, lng: -63.7443, zoom: 7 },
    'sgc-pr-13': { lat: 46.5653, lng: -66.4619, zoom: 7 },
    'sgc-pr-47': { lat: 52.9399, lng: -106.4509, zoom: 5 },
    'sgc-pr-10': { lat: 53.1355, lng: -57.6604, zoom: 5 },
    'sgc-pr-11': { lat: 46.5107, lng: -63.4168, zoom: 8 },
    'sgc-pr-60': { lat: 64.2823, lng: -135.0000, zoom: 5 },
    'sgc-pr-61': { lat: 64.8255, lng: -124.8457, zoom: 4 },
    'sgc-pr-62': { lat: 70.2998, lng: -83.1076, zoom: 3 },
    'sgc-cd-3520': { lat: 43.6532, lng: -79.3832, zoom: 11 },
    'sgc-csd-2466023': { lat: 45.5017, lng: -73.5673, zoom: 11 },
    'sgc-csd-2423027': { lat: 46.8139, lng: -71.2080, zoom: 11 },
    'sgc-csd-2481017': { lat: 45.4765, lng: -75.7013, zoom: 11 },
    'sgc-csd-2437067': { lat: 46.3432, lng: -72.5421, zoom: 11 },
    'sgc-csd-2460013': { lat: 45.7423, lng: -73.4497, zoom: 11 },
    'sgc-csd-2458227': { lat: 45.5312, lng: -73.5181, zoom: 11 },
    'sgc-csd-2494068': { lat: 48.4284, lng: -71.0684, zoom: 11 },
    'sgc-csd-2410043': { lat: 48.4488, lng: -68.5240, zoom: 11 },
    'sgc-csd-2436033': { lat: 46.5667, lng: -72.7500, zoom: 11 },
    'sgc-csd-2425213': { lat: 46.8033, lng: -71.1779, zoom: 11 },
    'sgc-csd-2443027': { lat: 45.4042, lng: -71.8929, zoom: 11 },
    'sgc-cd-2465': { lat: 45.6066, lng: -73.7124, zoom: 11 },
    'sgc-cd-3506': { lat: 45.4215, lng: -75.6972, zoom: 10 },
    'sgc-csd-5915022': { lat: 49.2827, lng: -123.1207, zoom: 11 },
    'sgc-csd-4806016': { lat: 51.0447, lng: -114.0719, zoom: 10 },
    'sgc-csd-4811061': { lat: 53.5461, lng: -113.4938, zoom: 10 },
    'sgc-csd-4611040': { lat: 49.8951, lng: -97.1384, zoom: 10 },
    'sgc-csd-1209034': { lat: 44.6488, lng: -63.5752, zoom: 10 },
    'sgc-cd-3525': { lat: 43.2557, lng: -79.8711, zoom: 10 },
    'sgc-csd-5915004': { lat: 49.1913, lng: -122.8490, zoom: 10 },
    'ca-on-oshawa': { lat: 43.8971, lng: -78.8658, zoom: 11 },
    'sgc-csd-3518005': { lat: 43.8509, lng: -79.0204, zoom: 11 },
    'sgc-csd-3518001': { lat: 43.8384, lng: -79.0868, zoom: 11 },
    'sgc-csd-3518009': { lat: 43.8975, lng: -78.9429, zoom: 11 },
    'ca-on-durham': { lat: 44.0500, lng: -78.9500, zoom: 9 },
    'sgc-csd-3521005': { lat: 43.5890, lng: -79.6441, zoom: 11 },
    'sgc-csd-3521010': { lat: 43.7315, lng: -79.7624, zoom: 11 },
    'sgc-cd-3521': { lat: 43.7000, lng: -79.8000, zoom: 9 },
    'sgc-csd-5917034': { lat: 48.4284, lng: -123.3656, zoom: 12 },
    'sgc-cd-3530': { lat: 43.4643, lng: -80.5204, zoom: 10 },
    'sgc-csd-3530013': { lat: 43.4516, lng: -80.4925, zoom: 11 },
    'sgc-csd-3530010': { lat: 43.3616, lng: -80.3144, zoom: 11 },
    'sgc-csd-3530016': { lat: 43.4643, lng: -80.5204, zoom: 11 },
    'sgc-csd-3539036': { lat: 42.9849, lng: -81.2453, zoom: 11 },
    'sgc-csd-5935010': { lat: 49.8880, lng: -119.4960, zoom: 11 },
    'sgc-csd-1310032': { lat: 45.9636, lng: -66.6431, zoom: 11 },
    'sgc-csd-3524002': { lat: 43.3255, lng: -79.7990, zoom: 11 },
    'sgc-csd-3524001': { lat: 43.4675, lng: -79.6877, zoom: 11 },
    'sgc-csd-3524009': { lat: 43.5183, lng: -79.8774, zoom: 11 },
    'sgc-cd-3553': { lat: 46.4900, lng: -80.9900, zoom: 10 },
    'sgc-csd-5915025': { lat: 49.2488, lng: -122.9805, zoom: 11 },
    'sgc-csd-4711066': { lat: 52.1332, lng: -106.6700, zoom: 11 },
    'sgc-csd-3519036': { lat: 43.8561, lng: -79.3370, zoom: 11 },
    'sgc-csd-3519048': { lat: 44.0592, lng: -79.4613, zoom: 11 },
    'sgc-cd-3519': { lat: 44.0000, lng: -79.4667, zoom: 9 },
    'sgc-csd-3526043': { lat: 43.0896, lng: -79.0849, zoom: 11 },
    'sgc-csd-3526032': { lat: 42.9922, lng: -79.2483, zoom: 11 },
    'sgc-csd-1307022': { lat: 46.0878, lng: -64.7782, zoom: 11 },
    'sgc-csd-3523008': { lat: 43.5448, lng: -80.2482, zoom: 11 },
    'sgc-csd-5917021': { lat: 48.4844, lng: -123.3816, zoom: 11 },
    'sgc-csd-3512005': { lat: 44.1628, lng: -77.3832, zoom: 11 },
    'sgc-csd-6106023': { lat: 62.4540, lng: -114.3718, zoom: 11 },
    'sgc-csd-3543042': { lat: 44.3894, lng: -79.6903, zoom: 11 },
    'sgc-csd-3558004': { lat: 48.3809, lng: -89.2477, zoom: 11 },
    'sgc-cd-3536': { lat: 42.4048, lng: -82.1910, zoom: 10 },
    'sgc-cd-3516': { lat: 44.3565, lng: -78.7401, zoom: 9 },
    'sgc-csd-5907035': { lat: 49.6006, lng: -119.6778, zoom: 11 },
    'sgc-csd-3528052': { lat: 42.8420, lng: -80.3040, zoom: 10 },
    'sgc-csd-3528018': { lat: 42.9300, lng: -79.8500, zoom: 10 },
    'sgc-csd-4802012': { lat: 49.6956, lng: -112.8451, zoom: 11 },
    'sgc-csd-4801006': { lat: 50.0417, lng: -110.6775, zoom: 11 },
    'sgc-csd-4806021': { lat: 51.2917, lng: -114.0144, zoom: 11 },
    'sgc-csd-4815023': { lat: 51.0890, lng: -115.3590, zoom: 11 },
    'sgc-csd-5907041': { lat: 49.4991, lng: -119.5937, zoom: 11 },
    'sgc-csd-5915001': { lat: 49.1044, lng: -122.6580, zoom: 11 },
    'sgc-cd-3540': { lat: 43.5833, lng: -81.5000, zoom: 9 },
    'sgc-cd-1211': { lat: 45.7500, lng: -64.0000, zoom: 8 },
    'sgc-csd-1301006': { lat: 45.2733, lng: -66.0633, zoom: 11 }
};

const CANONICAL_SLUG_OVERRIDES = {
    'ca': 'canada',
    'ca-on': 'ontario',
    'sgc-pr-24': 'quebec',
    'sgc-pr-48': 'alberta',
    'sgc-pr-59': 'british-columbia',
    'sgc-pr-46': 'manitoba',
    'sgc-pr-12': 'nova-scotia',
    'sgc-pr-13': 'new-brunswick',
    'sgc-pr-47': 'saskatchewan',
    'sgc-pr-10': 'newfoundland-and-labrador',
    'sgc-pr-11': 'prince-edward-island',
    'sgc-pr-60': 'yukon',
    'sgc-pr-61': 'northwest-territories',
    'sgc-pr-62': 'nunavut',
    'sgc-cd-3520': 'toronto-on',
    'sgc-csd-2466023': 'montreal-qc',
    'sgc-csd-2423027': 'quebec-city-qc',
    'sgc-csd-2481017': 'gatineau-qc',
    'sgc-csd-2437067': 'trois-rivieres-qc',
    'sgc-csd-2460013': 'repentigny-qc',
    'sgc-csd-2458227': 'longueuil-qc',
    'sgc-csd-2494068': 'saguenay-qc',
    'sgc-csd-2410043': 'rimouski-qc',
    'sgc-csd-2436033': 'shawinigan-qc',
    'sgc-csd-2425213': 'levis-qc',
    'sgc-csd-2443027': 'sherbrooke-qc',
    'sgc-cd-2465': 'laval-qc',
    'sgc-cd-3506': 'ottawa-on',
    'sgc-csd-5915022': 'vancouver-bc',
    'sgc-csd-4806016': 'calgary-ab',
    'sgc-csd-4811061': 'edmonton-ab',
    'sgc-csd-4611040': 'winnipeg-mb',
    'sgc-csd-1209034': 'halifax-ns',
    'sgc-cd-3525': 'hamilton-on',
    'sgc-csd-5915004': 'surrey-bc',
    'ca-on-oshawa': 'oshawa-on',
    'sgc-csd-3518005': 'ajax-on',
    'sgc-csd-3518001': 'pickering-on',
    'sgc-csd-3518009': 'whitby-on',
    'ca-on-durham': 'durham-region-on',
    'sgc-csd-3521005': 'mississauga-on',
    'sgc-csd-3521010': 'brampton-on',
    'sgc-cd-3521': 'peel-region-on',
    'sgc-csd-5917034': 'victoria-bc',
    'sgc-cd-3530': 'waterloo-region-on',
    'sgc-csd-3530013': 'kitchener-on',
    'sgc-csd-3530010': 'cambridge-on',
    'sgc-csd-3530016': 'waterloo-on',
    'sgc-csd-3539036': 'london-on',
    'sgc-csd-5935010': 'kelowna-bc',
    'sgc-csd-1310032': 'fredericton-nb',
    'sgc-csd-3524002': 'burlington-on',
    'sgc-csd-3524001': 'oakville-on',
    'sgc-csd-3524009': 'milton-on',
    'sgc-cd-3553': 'greater-sudbury-on',
    'sgc-csd-5915025': 'burnaby-bc',
    'sgc-csd-4711066': 'saskatoon-sk',
    'sgc-csd-3519036': 'markham-on',
    'sgc-csd-3519048': 'newmarket-on',
    'sgc-cd-3519': 'york-region-on',
    'sgc-csd-3526043': 'niagara-falls-on',
    'sgc-csd-3526032': 'welland-on',
    'sgc-csd-1307022': 'moncton-nb',
    'sgc-csd-3523008': 'guelph-on',
    'sgc-csd-5917021': 'saanich-bc',
    'sgc-csd-3512005': 'belleville-on',
    'sgc-csd-6106023': 'yellowknife-nt',
    'sgc-csd-3543042': 'barrie-on',
    'sgc-csd-3558004': 'thunder-bay-on',
    'sgc-cd-3536': 'chatham-kent-on',
    'sgc-cd-3516': 'kawartha-lakes-on',
    'sgc-csd-5907035': 'summerland-bc',
    'sgc-csd-3528052': 'norfolk-county-on',
    'sgc-csd-3528018': 'haldimand-county-on',
    'sgc-csd-4802012': 'lethbridge-ab',
    'sgc-csd-4801006': 'medicine-hat-ab',
    'sgc-csd-4806021': 'airdrie-ab',
    'sgc-csd-4815023': 'canmore-ab',
    'sgc-csd-5907041': 'penticton-bc',
    'sgc-csd-5915001': 'langley-bc',
    'sgc-cd-3540': 'huron-county-on',
    'sgc-cd-1211': 'cumberland-county-ns',
    'sgc-csd-1301006': 'saint-john-nb'
};

const PROVINCE_POSTAL_CODES = {
    '10': 'NL',
    '11': 'PE',
    '12': 'NS',
    '13': 'NB',
    '24': 'QC',
    '35': 'ON',
    '46': 'MB',
    '47': 'SK',
    '48': 'AB',
    '59': 'BC',
    '60': 'YT',
    '61': 'NT',
    '62': 'NU'
};

function slugify(text) {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function fetchPublicBuffer(url) {
    return new Promise((resolve, reject) => {
        const get = url.startsWith('https:') ? https.get : http.get;
        get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchPublicBuffer(res.headers.location));
            }
            if (res.statusCode !== 200) {
                return reject(new Error('Failed to fetch ' + url + ': status ' + res.statusCode));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function normalizePlaces(enRows, frRows) {
    const frByCode = new Map();
    for (const row of frRows) {
        if (row.Code) {
            frByCode.set(row.Code.trim(), row);
        }
    }

    const places = [];
    const identifiers = [];
    const seenIds = new Set();

    // 1. Country: Canada
    places.push({
        id: 'ca',
        slug: 'canada',
        kind: 'country',
        nameEn: 'Canada',
        nameFr: 'Canada',
        typeEn: 'Country',
        typeFr: 'Pays',
        parentId: null,
        featured: true,
        latitude: PLACE_VIEWPORTS['ca'].lat,
        longitude: PLACE_VIEWPORTS['ca'].lng,
        defaultZoom: PLACE_VIEWPORTS['ca'].zoom
    });
    seenIds.add('ca');

    // 2. Parse StatCan SGC CSV
    for (const enRow of enRows) {
        const code = enRow.Code ? enRow.Code.trim() : '';
        if (!code) continue;

        const frRow = frByCode.get(code) || {};
        const level = (enRow.Level || '').trim();
        const typeCode = (enRow.Type || '').trim();
        const rawNameEn = (enRow['Class name'] || '').trim();
        const rawNameFr = (frRow['Class name'] || rawNameEn).trim();

        let id = '';
        let kind = '';
        let parentId = null;
        let scheme = '';
        let typeEn = typeCode;
        let typeFr = typeCode;

        if (level === '1') {
            // Province / Territory
            id = 'sgc-pr-' + code;
            kind = ['60', '61', '62'].includes(code) ? 'territory' : 'province';
            parentId = 'ca';
            scheme = 'sgc-pr';
            typeEn = kind === 'territory' ? 'Territory' : 'Province';
            typeFr = kind === 'territory' ? 'Territoire' : 'Province';
        } else if (level === '2') {
            // Census Division (CD)
            id = 'sgc-cd-' + code;
            kind = 'region';
            const prCode = code.substring(0, 2);
            parentId = 'sgc-pr-' + prCode;
            scheme = 'sgc-cd';
            typeEn = 'Census Division';
            typeFr = 'Division de recensement';
        } else if (level === '3') {
            // Census Subdivision (CSD)
            id = 'sgc-csd-' + code;
            kind = 'municipality';
            const cdCode = code.substring(0, 4);
            parentId = 'sgc-cd-' + cdCode;
            scheme = 'sgc-csd';
            const mappedType = MUNICIPAL_TYPES[typeCode];
            if (mappedType) {
                typeEn = mappedType.en;
                typeFr = mappedType.fr;
            }
        } else {
            continue;
        }

        if (seenIds.has(id)) continue;
        seenIds.add(id);

        let slug = CANONICAL_SLUG_OVERRIDES[id];
        if (!slug) {
            const prCode = code.substring(0, 2);
            const provPostal = PROVINCE_POSTAL_CODES[prCode] ? PROVINCE_POSTAL_CODES[prCode].toLowerCase() : '';
            const baseSlug = slugify(rawNameEn);
            slug = provPostal ? baseSlug + '-' + provPostal : baseSlug;
        }

        const viewport = PLACE_VIEWPORTS[id] || null;
        const featured = FEATURED_PLACE_IDS.has(id);

        places.push({
            id,
            slug,
            kind,
            nameEn: rawNameEn,
            nameFr: rawNameFr,
            typeEn,
            typeFr,
            parentId,
            featured,
            latitude: viewport ? viewport.lat : null,
            longitude: viewport ? viewport.lng : null,
            defaultZoom: viewport ? viewport.zoom : null
        });

        identifiers.push({
            placeId: id,
            scheme,
            vintage: '2021',
            value: code
        });
    }

    // Explicitly add synthetic regional overrides if defined
    if (!seenIds.has('ca-on')) {
        places.push({
            id: 'ca-on',
            slug: 'ontario',
            kind: 'province',
            nameEn: 'Ontario',
            nameFr: 'Ontario',
            typeEn: 'Province',
            typeFr: 'Province',
            parentId: 'ca',
            featured: true,
            latitude: PLACE_VIEWPORTS['ca-on'].lat,
            longitude: PLACE_VIEWPORTS['ca-on'].lng,
            defaultZoom: PLACE_VIEWPORTS['ca-on'].zoom
        });
    }

    if (!seenIds.has('ca-on-oshawa')) {
        places.push({
            id: 'ca-on-oshawa',
            slug: 'oshawa-on',
            kind: 'municipality',
            nameEn: 'Oshawa',
            nameFr: 'Oshawa',
            typeEn: 'City',
            typeFr: 'Ville',
            parentId: 'ca-on-durham',
            featured: true,
            latitude: PLACE_VIEWPORTS['ca-on-oshawa'].lat,
            longitude: PLACE_VIEWPORTS['ca-on-oshawa'].lng,
            defaultZoom: PLACE_VIEWPORTS['ca-on-oshawa'].zoom
        });
    }

    if (!seenIds.has('ca-on-durham')) {
        places.push({
            id: 'ca-on-durham',
            slug: 'durham-region-on',
            kind: 'region',
            nameEn: 'Regional Municipality of Durham',
            nameFr: 'Municipalité régionale de Durham',
            typeEn: 'Regional Municipality',
            typeFr: 'Municipalité régionale',
            parentId: 'ca-on',
            featured: true,
            latitude: PLACE_VIEWPORTS['ca-on-durham'].lat,
            longitude: PLACE_VIEWPORTS['ca-on-durham'].lng,
            defaultZoom: PLACE_VIEWPORTS['ca-on-durham'].zoom
        });
    }

    return { places, identifiers };
}

function planAliases(existingPlaces, normalizedPlaces, existingAliases) {
    const existingById = new Map(existingPlaces.map(p => [p.id, p]));
    const aliasBySlug = new Map(existingAliases.map(a => [a.slug, a]));
    const plannedPlaceSlugs = new Set(normalizedPlaces.map(p => p.slug));

    const aliasesToAdd = [];
    const conflicts = [];

    for (const place of normalizedPlaces) {
        const existing = existingById.get(place.id);
        if (!existing || existing.slug === place.slug) {
            continue;
        }

        if (plannedPlaceSlugs.has(existing.slug)) {
            continue;
        }

        const existingAlias = aliasBySlug.get(existing.slug);
        if (existingAlias && existingAlias.placeId !== place.id) {
            conflicts.push({
                placeId: place.id,
                slug: existing.slug,
                reason: 'alias-claimed',
                expectedPlaceId: place.id,
                existingPlaceId: existingAlias.placeId
            });
            continue;
        }

        if (!existingAlias) {
            aliasesToAdd.push({ placeId: place.id, slug: existing.slug });
        }
    }

    return { aliasesToAdd, conflicts };
}

async function apply(client, normalized) {
    const { places, identifiers } = normalized;

    const existingPlacesRes = await client.query('SELECT id, slug, kind FROM places');
    const existingAliasesRes = await client.query('SELECT place_id AS "placeId", slug FROM place_aliases');
    const { aliasesToAdd, conflicts } = planAliases(existingPlacesRes.rows, places, existingAliasesRes.rows);

    if (conflicts.length > 0) {
        throw new Error('Conflicting aliases: ' + JSON.stringify(conflicts));
    }

    const placeIds = places.map(p => p.id);
    const slugs = places.map(p => p.slug);
    const kinds = places.map(p => p.kind);
    const namesEn = places.map(p => p.nameEn);
    const namesFr = places.map(p => p.nameFr);
    const typesEn = places.map(p => p.typeEn);
    const typesFr = places.map(p => p.typeFr);
    const parentIds = places.map(p => p.parentId);
    const featuredList = places.map(p => p.featured);
    const lats = places.map(p => p.latitude);
    const lngs = places.map(p => p.longitude);
    const zooms = places.map(p => p.defaultZoom);

    await client.query(`
        INSERT INTO places (id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id, featured, latitude, longitude, default_zoom, enabled)
        SELECT
            p.id, p.slug, p.kind, p.name_en, p.name_fr, p.type_en, p.type_fr, p.parent_id, p.featured, p.latitude, p.longitude, p.default_zoom, true
        FROM UNNEST(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
            $6::text[], $7::text[], $8::text[], $9::boolean[],
            $10::double precision[], $11::double precision[], $12::integer[]
        ) AS p(id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id, featured, latitude, longitude, default_zoom)
        ON CONFLICT (id) DO UPDATE SET
            slug = EXCLUDED.slug,
            kind = EXCLUDED.kind,
            name_en = EXCLUDED.name_en,
            name_fr = EXCLUDED.name_fr,
            type_en = EXCLUDED.type_en,
            type_fr = EXCLUDED.type_fr,
            parent_id = EXCLUDED.parent_id,
            featured = EXCLUDED.featured,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            default_zoom = EXCLUDED.default_zoom,
            enabled = true,
            updated_at = NOW();
    `, [placeIds, slugs, kinds, namesEn, namesFr, typesEn, typesFr, parentIds, featuredList, lats, lngs, zooms]);

    const identPlaceIds = identifiers.map(i => i.placeId);
    const identSchemes = identifiers.map(i => i.scheme);
    const identVintages = identifiers.map(i => i.vintage);
    const identValues = identifiers.map(i => i.value);

    await client.query(`
        INSERT INTO place_identifiers (place_id, scheme, vintage, value)
        SELECT
            i.place_id, i.scheme, i.vintage, i.value
        FROM UNNEST(
            $1::text[], $2::text[], $3::text[], $4::text[]
        ) AS i(place_id, scheme, vintage, value)
        ON CONFLICT (scheme, vintage, value) DO UPDATE SET
            place_id = EXCLUDED.place_id;
    `, [identPlaceIds, identSchemes, identVintages, identValues]);

    if (aliasesToAdd.length > 0) {
        const aliasPlaceIds = aliasesToAdd.map(a => a.placeId);
        const aliasSlugs = aliasesToAdd.map(a => a.slug);

        await client.query(`
            INSERT INTO place_aliases (slug, place_id)
            SELECT a.slug, a.place_id
            FROM UNNEST($1::text[], $2::text[]) AS a(slug, place_id)
            ON CONFLICT (slug) DO UPDATE SET
                place_id = EXCLUDED.place_id;
        `, [aliasSlugs, aliasPlaceIds]);
    }
}

async function sync() {
    console.log('Fetching StatCan SGC 2021 structure CSVs...');
    const [enBuf, frBuf] = await Promise.all([
        fetchPublicBuffer(EN_URL),
        fetchPublicBuffer(FR_URL)
    ]);

    const enRows = parse(enBuf, { columns: true, skip_empty_lines: true });
    const frRows = parse(frBuf, { columns: true, skip_empty_lines: true });

    console.log('Parsed ' + enRows.length + ' EN rows, ' + frRows.length + ' FR rows. Normalizing...');
    const normalized = normalizePlaces(enRows, frRows);
    console.log('Normalized ' + normalized.places.length + ' places, ' + normalized.identifiers.length + ' identifiers.');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://opencanada:opencanada@localhost:5432/opencanada'
    });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await apply(client, normalized);
        await client.query('COMMIT');
        console.log('Successfully applied SGC 2021 places and identifiers to database.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error syncing places:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    sync().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    normalizePlaces,
    planAliases,
    apply,
    FEATURED_PLACE_IDS,
    MUNICIPAL_TYPES,
    PLACE_VIEWPORTS,
    CANONICAL_SLUG_OVERRIDES
};
