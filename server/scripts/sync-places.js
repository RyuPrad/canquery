require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { fetchJson: fetchPublicJson } = require('../utils/cache');
const { syncMunicipalPlaces } = require('../services/municipalSyncService');

const STATCAN_SGC_API_URL = 'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=JSON&PR=00&THEME=1';

const SGC_PR_RE = /^sgc-pr-\d{2}$/;
const SGC_CD_RE = /^sgc-cd-\d{4}$/;
const SGC_CSD_RE = /^sgc-csd-\d{7}$/;

const FEATURED_PLACE_IDS = new Set([
    'ca-on',
    'sgc-pr-59',
    'sgc-pr-48',
    'sgc-pr-47',
    'sgc-pr-46',
    'sgc-pr-13',
    'sgc-pr-12',
    'sgc-pr-61',
    'sgc-cd-3518',
    'sgc-cd-3521',
    'sgc-cd-3524',
    'sgc-cd-3519',
    'sgc-cd-3526',
    'sgc-cd-3530',
    'sgc-cd-3553',
    'sgc-cd-3536',
    'sgc-cd-3516',
    'sgc-cd-3540',
    'sgc-cd-1211',
    'sgc-csd-3520005',
    'sgc-csd-3506008',
    'sgc-csd-5915022',
    'sgc-csd-4806016',
    'sgc-csd-4811061',
    'sgc-csd-4611040',
    'sgc-csd-1209034',
    'sgc-csd-3525005',
    'sgc-csd-5915004',
    'sgc-csd-5917034',
    'sgc-csd-3530013',
    'sgc-csd-3530016',
    'sgc-csd-3530010',
    'sgc-csd-3539036',
    'sgc-csd-5935010',
    'sgc-csd-1310032',
    'sgc-csd-3524002',
    'sgc-csd-3524001',
    'sgc-csd-3524009',
    'sgc-csd-5915025',
    'sgc-csd-4711066',
    'sgc-csd-3519036',
    'sgc-csd-3519048',
    'sgc-csd-3526043',
    'sgc-csd-3526065',
    'sgc-csd-1307022',
    'sgc-csd-3523001',
    'sgc-csd-5917021',
    'sgc-csd-3512005',
    'sgc-csd-6106023',
    'sgc-csd-3543042',
    'sgc-csd-3558004',
    'sgc-csd-5907035',
    'sgc-csd-3528052',
    'sgc-csd-3528018',
    'sgc-csd-4802012',
    'sgc-csd-4801006',
    'sgc-csd-4806021',
    'sgc-csd-4815023',
    'sgc-csd-5907041',
    'sgc-csd-5915001',
    'sgc-csd-3518013',
    'sgc-csd-3518005',
    'sgc-csd-3518009',
    'sgc-csd-3518001',
    'sgc-csd-3518020',
    'sgc-csd-3518029',
    'sgc-csd-3518038',
    'sgc-csd-3518039',
    'sgc-csd-3521005',
    'sgc-csd-3521010',
    'sgc-csd-3521024',
    'sgc-csd-2466023',
    'sgc-csd-2423027',
    'sgc-cd-2465'
]);

const MUNICIPAL_TYPES = {
    CY: { en: 'City', fr: 'Cité' },
    T: { en: 'Town', fr: 'Ville' },
    TP: { en: 'Township', fr: 'Canton' },
    MU: { en: 'Municipality', fr: 'Municipalité' },
    M: { en: 'Municipality', fr: 'Municipalité' },
    DM: { en: 'District municipality', fr: 'Municipalité de district' },
    VL: { en: 'Village', fr: 'Village' },
    RGM: { en: 'Regional municipality', fr: 'Municipalité régionale' },
    C: { en: 'City', fr: 'Cité' },
    V: { en: 'Ville', fr: 'Ville' },
    CT: { en: 'Canton (municipalité de)', fr: 'Canton (municipalité de)' }
};

const PLACE_VIEWPORTS = {
    'sgc-csd-4802012': { latitude: 49.6956, longitude: -112.8451, default_zoom: 10 },
    'sgc-csd-4801006': { latitude: 50.0417, longitude: -110.6775, default_zoom: 10 },
    'sgc-csd-4806021': { latitude: 51.2917, longitude: -114.0144, default_zoom: 10 },
    'sgc-csd-4815023': { latitude: 51.0890, longitude: -115.3590, default_zoom: 10 },
    'sgc-csd-5907041': { latitude: 49.4991, longitude: -119.5937, default_zoom: 10 },
    'sgc-csd-5915001': { latitude: 49.1044, longitude: -122.6580, default_zoom: 10 },
    'sgc-cd-3540': { latitude: 43.5833, longitude: -81.5000, default_zoom: 9 },
    'sgc-cd-1211': { latitude: 45.7500, longitude: -64.0000, default_zoom: 8 },
    'sgc-csd-6106023': { latitude: 62.4540, longitude: -114.3718, default_zoom: 11 },
    'sgc-csd-3543042': { latitude: 44.3894, longitude: -79.6903, default_zoom: 11 },
    'sgc-csd-3558004': { latitude: 48.3809, longitude: -89.2477, default_zoom: 11 },
    'sgc-cd-3536': { latitude: 42.4048, longitude: -82.1910, default_zoom: 10 },
    'sgc-cd-3516': { latitude: 44.3565, longitude: -78.7397, default_zoom: 9 },
    'sgc-csd-5907035': { latitude: 49.6006, longitude: -119.6778, default_zoom: 12 },
    'sgc-csd-3528052': { latitude: 42.8369, longitude: -80.3045, default_zoom: 10 },
    'sgc-csd-3528018': { latitude: 42.9092, longitude: -79.8524, default_zoom: 10 }
};

function normalize(place) {
    if (place.id === 'sgc-csd-4802012') return { ...place, slug: 'lethbridge-ab', featured: true };
    if (place.id === 'sgc-csd-4801006') return { ...place, slug: 'medicine-hat-ab', featured: true };
    if (place.id === 'sgc-csd-4806021') return { ...place, slug: 'airdrie-ab', featured: true };
    if (place.id === 'sgc-csd-4815023') return { ...place, slug: 'canmore-ab', featured: true };
    if (place.id === 'sgc-csd-5907041') return { ...place, slug: 'penticton-bc', featured: true };
    if (place.id === 'sgc-csd-5915001') return { ...place, slug: 'langley-bc', featured: true };
    if (place.id === 'sgc-cd-3540') return { ...place, slug: 'huron-county-on', featured: true };
    if (place.id === 'sgc-cd-1211') return { ...place, slug: 'cumberland-county-ns', featured: true };
    if (place.id === 'sgc-csd-6106023') return { ...place, slug: 'yellowknife-nt', featured: true };
    if (place.id === 'sgc-csd-3543042') return { ...place, slug: 'barrie-on', featured: true };
    if (place.id === 'sgc-csd-3558004') return { ...place, slug: 'thunder-bay-on', featured: true };
    if (place.id === 'sgc-cd-3536') return { ...place, slug: 'chatham-kent-on', featured: true };
    if (place.id === 'sgc-cd-3516') return { ...place, slug: 'kawartha-lakes-on', featured: true };
    if (place.id === 'sgc-csd-5907035') return { ...place, slug: 'summerland-bc', featured: true };
    if (place.id === 'sgc-csd-3528052') return { ...place, slug: 'norfolk-county-on', featured: true };
    if (place.id === 'sgc-csd-3528018') return { ...place, slug: 'haldimand-county-on', featured: true };
    if (place.id === 'sgc-cd-3553') return { ...place, slug: 'greater-sudbury-on', featured: true };
    if (place.id === 'sgc-cd-3524') return { ...place, slug: 'halton-region-on', featured: true };
    if (place.id === 'sgc-csd-3524002') return { ...place, slug: 'burlington-on', featured: true };
    if (place.id === 'sgc-csd-3524001') return { ...place, slug: 'oakville-on', featured: true };
    if (place.id === 'sgc-csd-3524009') return { ...place, slug: 'milton-on', featured: true };
    if (place.id === 'sgc-csd-5915025') return { ...place, slug: 'burnaby-bc', featured: true };
    if (place.id === 'sgc-csd-4711066') return { ...place, slug: 'saskatoon-sk', featured: true };
    if (place.id === 'sgc-cd-3519') return { ...place, slug: 'york-region-on', featured: true };
    if (place.id === 'sgc-csd-3519036') return { ...place, slug: 'markham-on', featured: true };
    if (place.id === 'sgc-csd-3519048') return { ...place, slug: 'newmarket-on', featured: true };
    if (place.id === 'sgc-cd-3526') return { ...place, slug: 'niagara-region-on', featured: true };
    if (place.id === 'sgc-csd-3526043') return { ...place, slug: 'niagara-falls-on', featured: true };
    if (place.id === 'sgc-csd-3526065') return { ...place, slug: 'welland-on', featured: true };
    if (place.id === 'sgc-csd-1307022') return { ...place, slug: 'moncton-nb', featured: true };
    if (place.id === 'sgc-csd-3523001') return { ...place, slug: 'guelph-on', featured: true };
    if (place.id === 'sgc-csd-5917021') return { ...place, slug: 'saanich-bc', featured: true };
    if (place.id === 'sgc-csd-3512005') return { ...place, slug: 'belleville-on', featured: true };
    return place;
}

async function syncPlaces(options = {}) {
    return syncMunicipalPlaces(pool, {
        fetchJson: options.fetchJson || fetchPublicJson,
        featuredPlaceIds: FEATURED_PLACE_IDS,
        municipalTypes: MUNICIPAL_TYPES,
        viewports: PLACE_VIEWPORTS,
        normalizePlace: normalize
    });
}

if (require.main === module) {
    syncPlaces()
        .then(result => {
            console.log(JSON.stringify(result));
            return pool.end();
        })
        .catch(async error => {
            console.error(error);
            try { await pool.end(); } catch {}
            process.exit(1);
        });
}

module.exports = { syncPlaces, FEATURED_PLACE_IDS, MUNICIPAL_TYPES, PLACE_VIEWPORTS, normalize };
