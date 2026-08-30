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
    '3553005': 'sgc-cd-3553',
    '3516010': 'sgc-cd-3516',
    '3536020': 'sgc-cd-3536'
};
const SINGLE_TIER_CITY_CD = new Set(['2465', '3506', '3520', '3525', '3553', '3516', '3536']);
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
    'sgc-csd-3512005',
    'sgc-csd-6106023',
    'sgc-csd-3543042',
    'sgc-csd-3558004',
    'sgc-cd-3536',
    'sgc-cd-3516',
    'sgc-csd-5907035',
    'sgc-csd-3528052',
    'sgc-csd-4802012',
    'sgc-csd-4801006',
    'sgc-csd-4806021',
    'sgc-csd-4815023',
    'sgc-csd-5907041',
    'sgc-csd-5915001',
    'sgc-cd-3540',
    'sgc-cd-1211',
    'sgc-csd-3528018',
    'sgc-csd-2481017',
    'sgc-csd-2437067',
    'sgc-csd-2460013',
    'sgc-csd-2458227',
    'sgc-csd-2494068',
    'sgc-csd-2410043',
    'sgc-csd-2436033',
    'sgc-csd-2425213',
    'sgc-csd-2443027',
    'sgc-csd-1301006',
    'sgc-csd-6001009',
    'sgc-csd-1001519',
    'sgc-csd-1102075',
    'sgc-csd-4706027',
    'sgc-csd-3537039',
    'sgc-csd-3510010',
    'sgc-csd-4808011',
    'sgc-csd-5933042',
    'sgc-csd-5921007',
    'sgc-csd-5909052'
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
    '3520005': ['City', 'Ville'],
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
    '3553005': ['City', 'Ville'],
    '5915004': ['City', 'Ville'],
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
    '1307022': ['City', 'Cité'],
    '1310032': ['City', 'Cité'],
    '6106023': ['City', 'Ville'],
    '3543042': ['City', 'Ville'],
    '3558004': ['City', 'Ville'],
    '3536020': ['Municipality', 'Municipalité'],
    '3516010': ['City', 'Ville'],
    '5907035': ['District municipality', 'Municipalité de district'],
    '3528052': ['City', 'Ville'],
    '4802012': ['City', 'Ville'],
    '4801006': ['City', 'Ville'],
    '4806021': ['City', 'Ville'],
    '4815023': ['Town', 'Ville'],
    '5907041': ['City', 'Ville'],
    '5915001': ['City', 'Ville'],
    '3540': ['County', 'Comté'],
    '1211': ['County', 'Comté'],
    '3528018': ['City', 'Ville'],
    '2481017': ['City', 'Ville'],
    '2437067': ['City', 'Ville'],
    '2460013': ['City', 'Ville'],
    '2458227': ['City', 'Ville'],
    '2494068': ['City', 'Ville'],
    '2410043': ['City', 'Ville'],
    '2436033': ['City', 'Ville'],
    '2425213': ['City', 'Ville'],
    '2443027': ['City', 'Ville'],
    '1301006': ['City', 'Cité'],
    '6001009': ['City', 'Ville'],
    '1001519': ['City', 'Ville'],
    '1102075': ['City', 'Ville'],
    '4706027': ['City', 'Ville'],
    '3537039': ['City', 'Ville'],
    '3510010': ['City', 'Ville'],
    '4808011': ['City', 'Ville'],
    '5933042': ['City', 'Ville'],
    '5921007': ['City', 'Ville'],
    '5909052': ['City', 'Ville']
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
    '5917021': [48.4841, -123.3822, 10],
    '6106023': [62.4540, -114.3718, 10],
    '3543042': [44.3894, -79.6903, 10],
    '3558': [48.3809, -89.2477, 8],
    '3558004': [48.3809, -89.2477, 10],
    '3536': [42.4048, -82.1910, 9],
    '3516': [44.3564, -78.7408, 9],
    '5907035': [49.6006, -119.6778, 10],
    '3528052': [42.8333, -80.3833, 9],
    '4802012': [49.6956, -112.8451, 10],
    '4801006': [50.0417, -110.6775, 10],
    '4806021': [51.2917, -114.0144, 10],
    '4815023': [51.0890, -115.3590, 10],
    '5907041': [49.4991, -119.5937, 10],
    '5915001': [49.1044, -122.6580, 10],
    '3540': [43.5833, -81.5000, 9],
    '1211': [45.7500, -64.0000, 8],
    '3528018': [42.9333, -79.8667, 9],
    '2481017': [45.4765, -75.7013, 10],
    '2437067': [46.3432, -72.5421, 10],
    '2460013': [45.7423, -73.4497, 10],
    '2458227': [45.5312, -73.5181, 10],
    '2494068': [48.4284, -71.0684, 10],
    '2410043': [48.4488, -68.5240, 10],
    '2436033': [46.5667, -72.7500, 10],
    '2425213': [46.8033, -71.1779, 10],
    '2443027': [45.4042, -71.8929, 10],
    '1301006': [45.2733, -66.0633, 10],
    '6001009': [60.7212, -135.0568, 10],
    '1001519': [47.5615, -52.7126, 10],
    '1102075': [46.2382, -63.1311, 10],
    '4706027': [50.4452, -104.6189, 10],
    '3537039': [42.3149, -83.0364, 10],
    '3510010': [44.2312, -76.4860, 10],
    '4808011': [52.2690, -113.8116, 10],
    '5933042': [50.6745, -120.3273, 10],
    '5921007': [49.1659, -123.9401, 10],
    '5909052': [49.0504, -122.3045, 10]
};

function slugify(value) {
    return String(value || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/['’]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalize(enRows, frRows) {
    const frByCode = new Map(frRows.map(row => [String(row.Code), row]));
    const usedSlugs = new Set(['canada']);
    const places = [{
        id: 'ca',
        slug: 'canada',
        kind: 'country',
        nameEn: 'Canada',
        nameFr: 'Canada',
        typeEn: 'Country',
        typeFr: 'Pays',
        parentId: null,
        featured: false
    }];
    const identifiers = [{
        placeId: 'ca',
        scheme: 'sgc',
        vintage: '2021',
        value: '01'
    }];

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

        if (level === 4 && SINGLE_TIER_CITY_CSD[code]) {
            const placeId = SINGLE_TIER_CITY_CSD[code];
            identifiers.push({
                placeId,
                scheme: 'sgc-csd',
                vintage: '2021',
                value: code
            });
            continue;
        }

        let kind = 'municipality';
        let typeEn = 'Census subdivision';
        let typeFr = 'Subdivision de recensement';
        let parentId = 'sgc-cd-' + code.slice(0, 4);
        let id = 'sgc-csd-' + code;

        if (level === 2) {
            kind = TERRITORIES.has(code) ? 'territory' : 'province';
            typeEn = TERRITORIES.has(code) ? 'Territory' : 'Province';
            typeFr = TERRITORIES.has(code) ? 'Territoire' : 'Province';
            parentId = 'ca';
            id = code === '35' ? 'ca-on' : 'sgc-pr-' + code;
        } else if (level === 3) {
            kind = 'region';
            typeEn = 'Census division';
            typeFr = 'Division de recensement';
            parentId = provinceCode === '35' ? 'ca-on' : 'sgc-pr-' + provinceCode;
            id = 'sgc-cd-' + code;
        }

        if (SINGLE_TIER_CITY_CD.has(code)) {
            typeEn = 'City';
            typeFr = 'Ville';
        } else if (MUNICIPAL_TYPES[code]) {
            [typeEn, typeFr] = MUNICIPAL_TYPES[code];
        }

        let slug = slugify(nameEn);
        if (level === 3 || level === 4) {
            slug += '-' + provinceAbbr;
        }

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
        if (code === '3558') slug = 'thunder-bay-district-on';
        if (code === '3558004') slug = 'thunder-bay-on';
        if (code === '3516') slug = 'kawartha-lakes-on';
        if (code === '3536') slug = 'chatham-kent-on';
        if (code === '3543') slug = 'simcoe-county-on';
        if (code === '3543042') slug = 'barrie-on';
        if (code === '5907') slug = 'okanagan-similkameen-bc';
        if (code === '5907035') slug = 'summerland-bc';
        if (code === '3528') slug = 'haldimand-norfolk-on';
        if (code === '3528052') slug = 'norfolk-county-on';
        if (code === '4802012') slug = 'lethbridge-ab';
        if (code === '4801006') slug = 'medicine-hat-ab';
        if (code === '4806021') slug = 'airdrie-ab';
        if (code === '4815023') slug = 'canmore-ab';
        if (code === '5907041') slug = 'penticton-bc';
        if (code === '5915001') slug = 'langley-bc';
        if (code === '3540') slug = 'huron-county-on';
        if (code === '1211') slug = 'cumberland-county-ns';
        if (code === '3528018') slug = 'haldimand-county-on';
        if (code === '6106023') slug = 'yellowknife-nt';
        if (code === '2481') slug = 'gatineau-region-qc';
        if (code === '2481017') slug = 'gatineau-qc';
        if (code === '2437') slug = 'trois-rivieres-region-qc';
        if (code === '2437067') slug = 'trois-rivieres-qc';
        if (code === '2460013') slug = 'repentigny-qc';
        if (code === '2458') slug = 'longueuil-region-qc';
        if (code === '2458227') slug = 'longueuil-qc';
        if (code === '2494') slug = 'le-saguenay-et-son-fjord-qc';
        if (code === '2494068') slug = 'saguenay-qc';
        if (code === '2410043') slug = 'rimouski-qc';
        if (code === '2436') slug = 'shawinigan-region-qc';
        if (code === '2436033') slug = 'shawinigan-qc';
        if (code === '2425') slug = 'levis-region-qc';
        if (code === '2425213') slug = 'levis-qc';
        if (code === '2443') slug = 'sherbrooke-region-qc';
        if (code === '2443027') slug = 'sherbrooke-qc';
        if (code === '1301') slug = 'saint-john-county-nb';
        if (code === '1301006') slug = 'saint-john-nb';
        if (code === '6001') slug = 'yukon-cd-yt';
        if (code === '6001009') slug = 'whitehorse-yt';
        if (code === '1001') slug = 'division-no-1-nl';
        if (code === '1001519') slug = 'st-johns-nl';
        if (code === '1102') slug = 'queens-pe';
        if (code === '1102075') slug = 'charlottetown-pe';
        if (code === '4706') slug = 'division-no-6-sk';
        if (code === '4706027') slug = 'regina-sk';
        if (code === '3537') slug = 'essex-county-on';
        if (code === '3537039') slug = 'windsor-on';
        if (code === '3510') slug = 'frontenac-county-on';
        if (code === '3510010') slug = 'kingston-on';
        if (code === '4808') slug = 'division-no-8-ab';
        if (code === '4808011') slug = 'red-deer-ab';
        if (code === '5933') slug = 'thompson-nicola-bc';
        if (code === '5933042') slug = 'kamloops-bc';
        if (code === '5921') slug = 'nanaimo-region-bc';
        if (code === '5921007') slug = 'nanaimo-bc';
        if (code === '5909') slug = 'fraser-valley-bc';
        if (code === '5909052') slug = 'abbotsford-bc';

        if (usedSlugs.has(slug)) {
            slug = slug + '-' + code;
        }
        usedSlugs.add(slug);

        const isFeatured = FEATURED_PLACE_IDS.has(id);
        const viewport = PLACE_VIEWPORTS[code];

        places.push({
            id,
            slug,
            kind,
            nameEn,
            nameFr,
            typeEn,
            typeFr,
            parentId,
            featured: isFeatured,
            latitude: viewport ? viewport[0] : null,
            longitude: viewport ? viewport[1] : null,
            defaultZoom: viewport ? viewport[2] : null
        });

        identifiers.push({
            placeId: id,
            scheme: level === 2 ? 'sgc-pr' : (level === 3 ? 'sgc-cd' : 'sgc-csd'),
            vintage: '2021',
            value: code
        });
    }

    return { places, identifiers };
}

function planAliases(existingPlaces, canonicalPlaces, existingAliases = []) {
    const canonicalBySlug = new Map(canonicalPlaces.map(place => [place.slug, place]));
    const aliasBySlug = new Map(existingAliases.map(alias => [alias.slug, alias]));
    const existingById = new Map(existingPlaces.map(place => [place.id, place]));
    const aliasesToAdd = [];
    const conflicts = [];

    for (const place of canonicalPlaces) {
        const existing = existingById.get(place.id);
        if (!existing || !existing.slug || existing.slug === place.slug) continue;

        const currentCanonical = canonicalBySlug.get(existing.slug);
        if (currentCanonical && currentCanonical.id !== place.id) {
            conflicts.push({
                placeId: place.id,
                slug: existing.slug,
                reason: 'canonical-claimed',
                expectedPlaceId: place.id,
                existingPlaceId: currentCanonical.id
            });
            continue;
        }

        const currentAlias = aliasBySlug.get(existing.slug);
        if (currentAlias && currentAlias.placeId !== place.id) {
            conflicts.push({
                placeId: place.id,
                slug: existing.slug,
                reason: 'alias-claimed',
                expectedPlaceId: place.id,
                existingPlaceId: currentAlias.placeId
            });
            continue;
        }

        if (!currentAlias) {
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
        INSERT INTO place_identifiers (place_id, scheme, vintage, identifier, is_primary)
        SELECT
            i.place_id, i.scheme, i.vintage, i.identifier, true
        FROM UNNEST(
            $1::text[], $2::text[], $3::text[], $4::text[]
        ) AS i(place_id, scheme, vintage, identifier)
        ON CONFLICT (scheme, identifier) DO UPDATE SET
            place_id = EXCLUDED.place_id,
            vintage = EXCLUDED.vintage,
            is_primary = EXCLUDED.is_primary,
            updated_at = NOW();
    `, [identPlaceIds, identSchemes, identVintages, identValues]);

    if (aliasesToAdd.length > 0) {
        const aliasPlaceIds = aliasesToAdd.map(a => a.placeId);
        const aliasSlugs = aliasesToAdd.map(a => a.slug);

        await client.query(`
            INSERT INTO place_aliases (place_id, slug, kind)
            SELECT a.place_id, a.slug, 'legacy'
            FROM UNNEST($1::text[], $2::text[]) AS a(place_id, slug)
            ON CONFLICT (slug) DO UPDATE SET
                place_id = EXCLUDED.place_id,
                kind = EXCLUDED.kind,
                updated_at = NOW();
        `, [aliasPlaceIds, aliasSlugs]);
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
    const normalized = normalize(enRows, frRows);
    console.log('Normalized ' + normalized.places.length + ' places, ' + normalized.identifiers.length + ' identifiers.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await apply(client, normalized);
        await client.query('COMMIT');
        console.log('Successfully synced StatCan SGC 2021 places to database.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error syncing places:', err);
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    sync().then(() => pool.end()).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    PROVINCES,
    TERRITORIES,
    SINGLE_TIER_CITY_CSD,
    SINGLE_TIER_CITY_CD,
    FEATURED_PLACE_IDS,
    MUNICIPAL_TYPES,
    PLACE_VIEWPORTS,
    slugify,
    normalize,
    planAliases,
    apply,
    sync
};
