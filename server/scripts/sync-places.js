const { Client } = require('pg');
const { fetchPublicBuffer } = require('../services/publicJson');

const PROVINCES = {
    '10': 'NL', '11': 'PE', '12': 'NS', '13': 'NB', '24': 'QC',
    '35': 'ON', '46': 'MB', '47': 'SK', '48': 'AB', '59': 'BC',
    '60': 'YT', '61': 'NT', '62': 'NU'
};

const PROVINCE_NAMES = {
    '10': { en: 'Newfoundland and Labrador', fr: 'Terre-Neuve-et-Labrador' },
    '11': { en: 'Prince Edward Island', fr: 'Île-du-Prince-Édouard' },
    '12': { en: 'Nova Scotia', fr: 'Nouvelle-Écosse' },
    '13': { en: 'New Brunswick', fr: 'Nouveau-Brunswick' },
    '24': { en: 'Quebec', fr: 'Québec' },
    '35': { en: 'Ontario', fr: 'Ontario' },
    '46': { en: 'Manitoba', fr: 'Manitoba' },
    '47': { en: 'Saskatchewan', fr: 'Saskatchewan' },
    '48': { en: 'Alberta', fr: 'Alberta' },
    '59': { en: 'British Columbia', fr: 'Colombie-Britannique' },
    '60': { en: 'Yukon', fr: 'Yukon' },
    '61': { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' },
    '62': { en: 'Nunavut', fr: 'Nunavut' }
};

const CSD_TYPES = {
    'C': { en: 'City', fr: 'Cité / Ville' },
    'CY': { en: 'City', fr: 'Cité / Ville' },
    'V': { en: 'Ville', fr: 'Ville' },
    'T': { en: 'Town', fr: 'Ville' },
    'TP': { en: 'Township', fr: 'Canton' },
    'M': { en: 'Municipality', fr: 'Municipalité' },
    'MU': { en: 'Municipality', fr: 'Municipalité' },
    'DM': { en: 'District municipality', fr: 'Municipalité de district' },
    'VL': { en: 'Village', fr: 'Village' },
    'RGM': { en: 'Regional municipality', fr: 'Municipalité régionale' },
    'RM': { en: 'Rural municipality', fr: 'Municipalité rurale' },
    'IM': { en: 'Island municipality', fr: 'Municipalité insulaire' },
    'P': { en: 'Parish', fr: 'Paroisse' },
    'PE': { en: 'Paroisse (municipalité de)', fr: 'Paroisse (municipalité de)' },
    'CT': { en: 'Canton (municipalité de)', fr: 'Canton (municipalité de)' },
    'CU': { en: 'Cantons unis (municipalité de)', fr: 'Cantons unis (municipalité de)' },
    'NO': { en: 'Northern subdivision', fr: 'Subdivision nordique' },
    'SV': { en: 'Summer village', fr: 'Village d\'été' },
    'RG': { en: 'Region', fr: 'Région' },
    'RD': { en: 'Regional district', fr: 'District régional' },
    'DIV': { en: 'Division', fr: 'Division' },
    'CDR': { en: 'Census division', fr: 'Division de recensement' }
};

const SGC_MUNICIPAL_TYPES = {
    '1001519': { en: 'City', fr: 'Cité / Ville' },
    '1102075': { en: 'City', fr: 'Cité / Ville' },
    '1209034': { en: 'Regional municipality', fr: 'Municipalité régionale' },
    '1301006': { en: 'City', fr: 'Cité / Ville' },
    '1307019': { en: 'Parish', fr: 'Paroisse' },
    '1307022': { en: 'City', fr: 'Cité / Ville' },
    '1310032': { en: 'City', fr: 'Cité / Ville' },
    '2410043': { en: 'Ville', fr: 'Ville' },
    '2423027': { en: 'Ville', fr: 'Ville' },
    '2425213': { en: 'Ville', fr: 'Ville' },
    '2436033': { en: 'Ville', fr: 'Ville' },
    '2437067': { en: 'Ville', fr: 'Ville' },
    '2443027': { en: 'Ville', fr: 'Ville' },
    '2458227': { en: 'Ville', fr: 'Ville' },
    '2460013': { en: 'Ville', fr: 'Ville' },
    '2466023': { en: 'Ville', fr: 'Ville' },
    '2494068': { en: 'Ville', fr: 'Ville' },
    '3506008': { en: 'City', fr: 'Cité / Ville' },
    '3510010': { en: 'City', fr: 'Cité / Ville' },
    '3512005': { en: 'City', fr: 'Cité / Ville' },
    '3518001': { en: 'City', fr: 'Cité / Ville' },
    '3518005': { en: 'Town', fr: 'Ville' },
    '3518009': { en: 'Town', fr: 'Ville' },
    '3518013': { en: 'City', fr: 'Cité / Ville' },
    '3518017': { en: 'Municipality', fr: 'Municipalité' },
    '3518020': { en: 'Township', fr: 'Canton' },
    '3518029': { en: 'Township', fr: 'Canton' },
    '3518039': { en: 'Township', fr: 'Canton' },
    '3519036': { en: 'City', fr: 'Cité / Ville' },
    '3519048': { en: 'Town', fr: 'Ville' },
    '3520005': { en: 'City', fr: 'Cité / Ville' },
    '3521005': { en: 'City', fr: 'Cité / Ville' },
    '3521010': { en: 'City', fr: 'Cité / Ville' },
    '3521024': { en: 'Town', fr: 'Ville' },
    '3523008': { en: 'City', fr: 'Cité / Ville' },
    '3524001': { en: 'Town', fr: 'Ville' },
    '3524002': { en: 'City', fr: 'Cité / Ville' },
    '3524009': { en: 'Town', fr: 'Ville' },
    '3524015': { en: 'Town', fr: 'Ville' },
    '3525005': { en: 'City', fr: 'Cité / Ville' },
    '3526032': { en: 'City', fr: 'Cité / Ville' },
    '3526043': { en: 'City', fr: 'Cité / Ville' },
    '3528018': { en: 'City', fr: 'Cité / Ville' },
    '3528052': { en: 'City', fr: 'Cité / Ville' },
    '3530010': { en: 'City', fr: 'Cité / Ville' },
    '3530013': { en: 'City', fr: 'Cité / Ville' },
    '3530016': { en: 'City', fr: 'Cité / Ville' },
    '3530020': { en: 'Township', fr: 'Canton' },
    '3530027': { en: 'Township', fr: 'Canton' },
    '3530035': { en: 'Township', fr: 'Canton' },
    '3530042': { en: 'Township', fr: 'Canton' },
    '3537039': { en: 'City', fr: 'Cité / Ville' },
    '3539036': { en: 'City', fr: 'Cité / Ville' },
    '3543042': { en: 'City', fr: 'Cité / Ville' },
    '3553005': { en: 'City', fr: 'Cité / Ville' },
    '3558004': { en: 'City', fr: 'Cité / Ville' },
    '4611040': { en: 'City', fr: 'Cité / Ville' },
    '4706027': { en: 'City', fr: 'Cité / Ville' },
    '4711066': { en: 'City', fr: 'Cité / Ville' },
    '4801006': { en: 'City', fr: 'Cité / Ville' },
    '4802012': { en: 'City', fr: 'Cité / Ville' },
    '4806016': { en: 'City', fr: 'Cité / Ville' },
    '4806021': { en: 'City', fr: 'Cité / Ville' },
    '4808011': { en: 'City', fr: 'Cité / Ville' },
    '4811061': { en: 'City', fr: 'Cité / Ville' },
    '4815023': { en: 'Town', fr: 'Ville' },
    '5907035': { en: 'District municipality', fr: 'Municipalité de district' },
    '5907041': { en: 'City', fr: 'Cité / Ville' },
    '5909052': { en: 'City', fr: 'Cité / Ville' },
    '5915001': { en: 'City', fr: 'Cité / Ville' },
    '5915004': { en: 'City', fr: 'Cité / Ville' },
    '5915022': { en: 'City', fr: 'Cité / Ville' },
    '5915025': { en: 'City', fr: 'Cité / Ville' },
    '5917021': { en: 'District municipality', fr: 'Municipalité de district' },
    '5917034': { en: 'City', fr: 'Cité / Ville' },
    '5921007': { en: 'City', fr: 'Cité / Ville' },
    '5933042': { en: 'City', fr: 'Cité / Ville' },
    '5935010': { en: 'City', fr: 'Cité / Ville' },
    '6001009': { en: 'City', fr: 'Cité / Ville' },
    '6106023': { en: 'City', fr: 'Cité / Ville' }
};

const SINGLE_TIER_CITY_CD = new Set(['3506', '3520', '3525', '3536', '3553', '2465']);
const SINGLE_TIER_CITY_CSD = {
    '3506008': 'sgc-cd-3506',
    '3520005': 'sgc-cd-3520',
    '3525005': 'sgc-cd-3525',
    '3536020': 'sgc-cd-3536',
    '3553005': 'sgc-cd-3553',
    '2465005': 'sgc-cd-2465'
};

const FEATURED_PLACES = {
    'ca-on-toronto': {
        slug: 'toronto',
        bbox: [-79.639265, 43.580983, -79.115822, 43.855457],
        center: [-79.383184, 43.653226],
        zoom: 11
    },
    'sgc-cd-3520': {
        slug: 'toronto',
        bbox: [-79.639265, 43.580983, -79.115822, 43.855457],
        center: [-79.383184, 43.653226],
        zoom: 11
    },
    'ca-qc-montreal': {
        slug: 'montreal',
        bbox: [-73.974187, 45.410076, -73.473079, 45.704791],
        center: [-73.567256, 45.501689],
        zoom: 11
    },
    'sgc-csd-2466023': {
        slug: 'montreal',
        bbox: [-73.974187, 45.410076, -73.473079, 45.704791],
        center: [-73.567256, 45.501689],
        zoom: 11
    },
    'ca-on-ottawa': {
        slug: 'ottawa',
        bbox: [-76.353916, 44.962002, -75.246574, 45.537651],
        center: [-75.697193, 45.42153],
        zoom: 10
    },
    'sgc-cd-3506': {
        slug: 'ottawa',
        bbox: [-76.353916, 44.962002, -75.246574, 45.537651],
        center: [-75.697193, 45.42153],
        zoom: 10
    },
    'ca-ab-calgary': {
        slug: 'calgary',
        bbox: [-114.316035, 50.842822, -113.859892, 51.212425],
        center: [-114.071889, 51.044733],
        zoom: 11
    },
    'sgc-csd-4806016': {
        slug: 'calgary',
        bbox: [-114.316035, 50.842822, -113.859892, 51.212425],
        center: [-114.071889, 51.044733],
        zoom: 11
    },
    'ca-ab-edmonton': {
        slug: 'edmonton',
        bbox: [-113.713697, 53.395786, -113.271515, 53.654452],
        center: [-113.493823, 53.546125],
        zoom: 11
    },
    'sgc-csd-4811061': {
        slug: 'edmonton',
        bbox: [-113.713697, 53.395786, -113.271515, 53.654452],
        center: [-113.493823, 53.546125],
        zoom: 11
    },
    'ca-bc-vancouver': {
        slug: 'vancouver',
        bbox: [-123.224787, 49.198445, -123.023242, 49.316171],
        center: [-123.120738, 49.282729],
        zoom: 12
    },
    'sgc-csd-5915022': {
        slug: 'vancouver',
        bbox: [-123.224787, 49.198445, -123.023242, 49.316171],
        center: [-123.120738, 49.282729],
        zoom: 12
    },
    'ca-mb-winnipeg': {
        slug: 'winnipeg',
        bbox: [-97.353724, 49.765668, -96.953888, 49.992225],
        center: [-97.138374, 49.895136],
        zoom: 11
    },
    'sgc-csd-4611040': {
        slug: 'winnipeg',
        bbox: [-97.353724, 49.765668, -96.953888, 49.992225],
        center: [-97.138374, 49.895136],
        zoom: 11
    },
    'ca-qc-quebec': {
        slug: 'quebec',
        bbox: [-71.503417, 46.711822, -71.157837, 46.948218],
        center: [-71.207981, 46.813878],
        zoom: 11
    },
    'sgc-csd-2423027': {
        slug: 'quebec',
        bbox: [-71.503417, 46.711822, -71.157837, 46.948218],
        center: [-71.207981, 46.813878],
        zoom: 11
    },
    'ca-ns-halifax': {
        slug: 'halifax',
        bbox: [-64.120483, 44.400032, -62.155457, 45.185641],
        center: [-63.575239, 44.648862],
        zoom: 10
    },
    'sgc-csd-1209034': {
        slug: 'halifax',
        bbox: [-64.120483, 44.400032, -62.155457, 45.185641],
        center: [-63.575239, 44.648862],
        zoom: 10
    },
    'ca-bc-surrey': {
        slug: 'surrey',
        bbox: [-122.922134, 49.002243, -122.684124, 49.219818],
        center: [-122.849014, 49.191345],
        zoom: 11
    },
    'sgc-csd-5915004': {
        slug: 'surrey',
        bbox: [-122.922134, 49.002243, -122.684124, 49.219818],
        center: [-122.849014, 49.191345],
        zoom: 11
    },
    'ca-qc-laval': {
        slug: 'laval',
        bbox: [-73.89679, 45.500332, -73.541336, 45.696144],
        center: [-73.71241, 45.569946],
        zoom: 11
    },
    'sgc-cd-2465': {
        slug: 'laval',
        bbox: [-73.89679, 45.500332, -73.541336, 45.696144],
        center: [-73.71241, 45.569946],
        zoom: 11
    },
    'ca-on-hamilton': {
        slug: 'hamilton',
        bbox: [-80.117188, 43.140808, -79.544525, 43.344406],
        center: [-79.8711, 43.2557],
        zoom: 11
    },
    'sgc-cd-3525': {
        slug: 'hamilton',
        bbox: [-80.117188, 43.140808, -79.544525, 43.344406],
        center: [-79.8711, 43.2557],
        zoom: 11
    },
    'ca-on-durham': {
        slug: 'durham-region',
        bbox: [-79.337158, 43.78418, -78.474731, 44.577637],
        center: [-78.8658, 44.0592],
        zoom: 10
    },
    'ca-on-oshawa': {
        slug: 'oshawa',
        bbox: [-78.961182, 43.834229, -78.78479, 44.020386],
        center: [-78.8658, 43.8971],
        zoom: 12
    },
    'sgc-csd-3518013': {
        slug: 'oshawa',
        bbox: [-78.961182, 43.834229, -78.78479, 44.020386],
        center: [-78.8658, 43.8971],
        zoom: 12
    },
    'sgc-csd-3518005': {
        slug: 'ajax',
        bbox: [-79.091187, 43.811646, -78.986816, 43.918457],
        center: [-79.0358, 43.8509],
        zoom: 12
    },
    'sgc-csd-3518001': {
        slug: 'pickering',
        bbox: [-79.168701, 43.799438, -79.020996, 44.030762],
        center: [-79.089, 43.8384],
        zoom: 12
    },
    'sgc-csd-3518009': {
        slug: 'whitby',
        bbox: [-79.000244, 43.829346, -78.879395, 44.072266],
        center: [-78.9386, 43.8975],
        zoom: 12
    },
    'ca-on-peel': {
        slug: 'peel-region',
        bbox: [-80.050659, 43.504028, -79.544067, 43.996582],
        center: [-79.7624, 43.6890],
        zoom: 10
    },
    'sgc-cd-3521': {
        slug: 'peel-region',
        bbox: [-80.050659, 43.504028, -79.544067, 43.996582],
        center: [-79.7624, 43.6890],
        zoom: 10
    },
    'sgc-csd-3521005': {
        slug: 'mississauga',
        bbox: [-79.795532, 43.504028, -79.544067, 43.74939],
        center: [-79.6441, 43.5890],
        zoom: 11
    },
    'sgc-csd-3521010': {
        slug: 'brampton',
        bbox: [-79.882812, 43.619995, -79.620361, 43.829956],
        center: [-79.7624, 43.7315],
        zoom: 11
    },
    'sgc-csd-3521024': {
        slug: 'caledon',
        bbox: [-80.050659, 43.708496, -79.697876, 43.996582],
        center: [-79.8653, 43.8690],
        zoom: 11
    },
    'sgc-csd-5917034': {
        slug: 'victoria',
        bbox: [-123.407593, 48.406982, -123.310547, 48.460083],
        center: [-123.3656, 48.4284],
        zoom: 12
    },
    'sgc-cd-3530': {
        slug: 'waterloo-region',
        bbox: [-80.739746, 43.303833, -80.220947, 43.666992],
        center: [-80.4831, 43.4675],
        zoom: 10
    },
    'sgc-csd-3530013': {
        slug: 'kitchener',
        bbox: [-80.579834, 43.376465, -80.401001, 43.498535],
        center: [-80.4925, 43.4516],
        zoom: 12
    },
    'sgc-csd-3530016': {
        slug: 'waterloo',
        bbox: [-80.596924, 43.447876, -80.470581, 43.539429],
        center: [-80.5204, 43.4643],
        zoom: 12
    },
    'sgc-csd-3530010': {
        slug: 'cambridge',
        bbox: [-80.395508, 43.336182, -80.26001, 43.460083],
        center: [-80.3144, 43.3616],
        zoom: 12
    },
    'sgc-csd-3539036': {
        slug: 'london',
        bbox: [-81.391602, 42.871704, -81.12793, 43.080444],
        center: [-81.2453, 42.9849],
        zoom: 11
    },
    'sgc-csd-5935010': {
        slug: 'kelowna',
        bbox: [-119.558716, 49.805298, -119.349976, 50.010986],
        center: [-119.4960, 49.8880],
        zoom: 11
    },
    'sgc-csd-1310032': {
        slug: 'fredericton',
        bbox: [-66.741943, 45.890503, -66.568604, 46.002808],
        center: [-66.6431, 45.9636],
        zoom: 12
    },
    'sgc-cd-3524': {
        slug: 'halton-region',
        bbox: [-80.128784, 43.307495, -79.684448, 43.642578],
        center: [-79.8500, 43.4800],
        zoom: 10
    },
    'sgc-csd-3524001': {
        slug: 'oakville',
        bbox: [-79.799805, 43.38501, -79.645386, 43.535156],
        center: [-79.6877, 43.4501],
        zoom: 12
    },
    'sgc-csd-3524002': {
        slug: 'burlington',
        bbox: [-79.914551, 43.307495, -79.742432, 43.469238],
        center: [-79.7990, 43.3255],
        zoom: 12
    },
    'sgc-csd-3524009': {
        slug: 'milton',
        bbox: [-80.084839, 43.425903, -79.799805, 43.597412],
        center: [-79.8833, 43.5183],
        zoom: 12
    },
    'sgc-csd-3524015': {
        slug: 'halton-hills',
        bbox: [-80.128784, 43.54187, -79.829102, 43.701172],
        center: [-79.9500, 43.6300],
        zoom: 12
    },
    'sgc-cd-3553': {
        slug: 'greater-sudbury',
        bbox: [-81.650391, 46.257324, -80.536499, 46.852417],
        center: [-80.9930, 46.4900],
        zoom: 10
    },
    'sgc-csd-5915025': {
        slug: 'burnaby',
        bbox: [-123.023682, 49.199829, -122.880859, 49.299316],
        center: [-122.9805, 49.2488],
        zoom: 12
    },
    'sgc-csd-4711066': {
        slug: 'saskatoon',
        bbox: [-106.779785, 52.071533, -106.533203, 52.215576],
        center: [-106.6702, 52.1332],
        zoom: 11
    },
    'sgc-cd-3519': {
        slug: 'york-region',
        bbox: [-79.664307, 43.78418, -79.208984, 44.408569],
        center: [-79.4360, 44.0000],
        zoom: 10
    },
    'sgc-csd-3519036': {
        slug: 'markham',
        bbox: [-79.438477, 43.799438, -79.208984, 43.955078],
        center: [-79.3370, 43.8561],
        zoom: 12
    },
    'sgc-csd-3519048': {
        slug: 'newmarket',
        bbox: [-79.512939, 44.020386, -79.400635, 44.090576],
        center: [-79.4600, 44.0500],
        zoom: 12
    },
    'sgc-cd-3526': {
        slug: 'niagara-region',
        bbox: [-80.009766, 42.843628, -78.914795, 43.275146],
        center: [-79.2500, 43.0500],
        zoom: 10
    },
    'sgc-csd-3526043': {
        slug: 'niagara-falls',
        bbox: [-79.198608, 42.996216, -79.033813, 43.151855],
        center: [-79.0849, 43.0896],
        zoom: 12
    },
    'sgc-csd-3526032': {
        slug: 'welland',
        bbox: [-79.308472, 42.946167, -79.198608, 43.045654],
        center: [-79.2483, 42.9922],
        zoom: 12
    },
    'sgc-csd-1307022': {
        slug: 'moncton',
        bbox: [-64.919434, 46.046753, -64.718018, 46.160889],
        center: [-64.7782, 46.0878],
        zoom: 12
    },
    'sgc-csd-3523008': {
        slug: 'guelph',
        bbox: [-80.339966, 43.486328, -80.175171, 43.590698],
        center: [-80.2482, 43.5448],
        zoom: 12
    },
    'sgc-csd-5917021': {
        slug: 'saanich',
        bbox: [-123.476562, 48.434448, -123.310547, 48.566895],
        center: [-123.3833, 48.4833],
        zoom: 12
    },
    'sgc-csd-3512005': {
        slug: 'belleville',
        bbox: [-77.453613, 44.110107, -77.299805, 44.274902],
        center: [-77.3833, 44.1667],
        zoom: 12
    },
    'sgc-csd-6106023': {
        slug: 'yellowknife',
        bbox: [-114.477539, 62.409668, -114.301758, 62.508545],
        center: [-114.3718, 62.4540],
        zoom: 12
    },
    'sgc-csd-3543042': {
        slug: 'barrie',
        bbox: [-79.763184, 44.329834, -79.620361, 44.439697],
        center: [-79.6903, 44.3894],
        zoom: 12
    },
    'sgc-csd-3558004': {
        slug: 'thunder-bay',
        bbox: [-89.379883, 48.339844, -89.171143, 48.490601],
        center: [-89.2477, 48.3809],
        zoom: 12
    },
    'sgc-cd-3536': {
        slug: 'chatham-kent',
        bbox: [-82.529297, 42.147827, -81.793213, 42.666016],
        center: [-82.1890, 42.4048],
        zoom: 10
    },
    'sgc-cd-3516': {
        slug: 'kawartha-lakes',
        bbox: [-79.088135, 44.110107, -78.419189, 44.788818],
        center: [-78.7400, 44.3500],
        zoom: 10
    },
    'sgc-csd-5907035': {
        slug: 'summerland',
        bbox: [-119.742432, 49.563599, -119.610596, 49.646606],
        center: [-119.6760, 49.6006],
        zoom: 12
    },
    'sgc-csd-3528052': {
        slug: 'norfolk-county',
        bbox: [-80.704346, 42.564697, -80.050659, 43.030396],
        center: [-80.3000, 42.8400],
        zoom: 10
    },
    'sgc-csd-3528018': {
        slug: 'haldimand-county',
        bbox: [-80.128784, 42.779541, -79.522095, 43.140869],
        center: [-79.8800, 42.9700],
        zoom: 10
    },
    'sgc-csd-2481017': {
        slug: 'gatineau',
        bbox: [-75.923462, 45.405884, -75.462036, 45.567627],
        center: [-75.7013, 45.4765],
        zoom: 11
    },
    'sgc-csd-2437067': {
        slug: 'trois-rivieres',
        bbox: [-72.684937, 46.307373, -72.487183, 46.417236],
        center: [-72.5477, 46.3432],
        zoom: 12
    },
    'sgc-csd-2460013': {
        slug: 'repentigny',
        bbox: [-73.52478, 45.719604, -73.403931, 45.796509],
        center: [-73.4500, 45.7500],
        zoom: 12
    },
    'sgc-csd-2458227': {
        slug: 'longueuil',
        bbox: [-73.54126, 45.474854, -73.376465, 45.584717],
        center: [-73.5090, 45.5312],
        zoom: 12
    },
    'sgc-csd-2494068': {
        slug: 'saguenay',
        bbox: [-71.378174, 48.334351, -70.751953, 48.510132],
        center: [-71.0700, 48.4200],
        zoom: 11
    },
    'sgc-csd-2410043': {
        slug: 'rimouski',
        bbox: [-68.648071, 48.395996, -68.428345, 48.494873],
        center: [-68.5239, 48.4488],
        zoom: 12
    },
    'sgc-csd-2436033': {
        slug: 'shawinigan',
        bbox: [-72.827759, 46.505127, -72.630005, 46.61499],
        center: [-72.7481, 46.5574],
        zoom: 12
    },
    'sgc-csd-2425213': {
        slug: 'levis',
        bbox: [-71.367188, 46.689453, -71.092529, 46.854248],
        center: [-71.1833, 46.8000],
        zoom: 12
    },
    'sgc-csd-2443027': {
        slug: 'sherbrooke',
        bbox: [-72.03186, 45.340576, -71.801147, 45.450439],
        center: [-71.8929, 45.4042],
        zoom: 12
    },
    'sgc-csd-1301006': {
        slug: 'saint-john',
        bbox: [-66.195679, 45.228882, -65.986938, 45.349731],
        center: [-66.0633, 45.2733],
        zoom: 12
    },
    'sgc-csd-6001009': {
        slug: 'whitehorse',
        bbox: [-135.20874, 60.651855, -134.956055, 60.783691],
        center: [-135.0568, 60.7212],
        zoom: 12
    },
    'sgc-csd-1001519': {
        slug: 'st-johns',
        bbox: [-77.607422, 47.457886, -52.657471, 47.644653],
        center: [-52.7126, 47.5615],
        zoom: 12
    },
    'sgc-csd-1102075': {
        slug: 'charlottetown',
        bbox: [-63.193359, 46.225586, -63.083496, 46.291504],
        center: [-63.1311, 46.2382],
        zoom: 12
    },
    'sgc-csd-4706027': {
        slug: 'regina',
        bbox: [-104.732666, 50.394287, -104.534912, 50.515137],
        center: [-104.6189, 50.4452],
        zoom: 12
    },
    'sgc-csd-3537039': {
        slug: 'windsor',
        bbox: [-83.085938, 42.25769, -82.888184, 42.345581],
        center: [-83.0364, 42.3149],
        zoom: 12
    },
    'sgc-csd-3510010': {
        slug: 'kingston',
        bbox: [-76.673584, 44.208984, -76.409912, 44.34082],
        center: [-76.4860, 44.2312],
        zoom: 12
    },
    'sgc-csd-4808011': {
        slug: 'red-deer',
        bbox: [-113.884277, 52.229004, -113.730469, 52.327881],
        center: [-113.8115, 52.2681],
        zoom: 12
    },
    'sgc-csd-5933042': {
        slug: 'kamloops',
        bbox: [-120.476074, 50.628662, -120.212402, 50.760498],
        center: [-120.3273, 50.6745],
        zoom: 12
    },
    'sgc-csd-5921007': {
        slug: 'nanaimo',
        bbox: [-124.035645, 49.119873, -123.881836, 49.251709],
        center: [-123.9401, 49.1659],
        zoom: 12
    },
    'sgc-csd-5909052': {
        slug: 'abbotsford',
        bbox: [-122.420654, 49.002243, -122.189941, 49.123093],
        center: [-122.3294, 49.0504],
        zoom: 12
    }
};

function slugify(text) {
    return text.toString().toLowerCase().trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function parseSgcHierarchy(csvContent) {
    const lines = csvContent.split(/\r?\n/);
    const places = [];
    const identifiers = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = [];
        let current = '';
        let inQuotes = false;
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                cols.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        cols.push(current.trim());

        const level = cols[0];
        const code = cols[1];
        const nameEn = cols[2];
        const nameFr = cols[3];
        const typeCode = cols[4];

        let placeId = null;
        let kind = null;
        let parentId = null;
        let typeEn = null;
        let typeFr = null;

        if (level === '1') {
            kind = 'country';
            placeId = 'ca';
            typeEn = 'Country';
            typeFr = 'Pays';
        } else if (level === '2') {
            kind = 'province';
            const provAbbr = PROVINCES[code] || code;
            placeId = 'ca-' + provAbbr.toLowerCase();
            parentId = 'ca';
            typeEn = 'Province';
            typeFr = 'Province';
        } else if (level === '3') {
            kind = 'region';
            const provCode = code.slice(0, 2);
            parentId = 'ca-' + (PROVINCES[provCode] || provCode).toLowerCase();
            placeId = code === '3518'
                ? 'ca-on-durham'
                : 'sgc-cd-' + code;
            const provCodeCd = code.slice(0, 2);
            const provinceAbbr = PROVINCES[provCodeCd] || provCodeCd;
            typeEn = 'Census division';
            typeFr = 'Division de recensement';
            if (CSD_TYPES[typeCode]) {
                typeEn = CSD_TYPES[typeCode].en;
                typeFr = CSD_TYPES[typeCode].fr;
            }
        } else if (level === '4') {
            kind = 'municipality';
            const cdCode = code.slice(0, 4);
            parentId = cdCode === '3518'
                ? 'ca-on-durham'
                : (SINGLE_TIER_CITY_CD.has(cdCode) && SINGLE_TIER_CITY_CSD[code]
                    ? 'ca-on'
                    : 'sgc-cd-' + cdCode);
            const provCode = code.slice(0, 2);
            const provinceAbbr = PROVINCES[provCode] || provCode;
            typeEn = 'Census subdivision';
            typeFr = 'Subdivision de recensement';
            if (SGC_MUNICIPAL_TYPES[code]) {
                typeEn = SGC_MUNICIPAL_TYPES[code].en;
                typeFr = SGC_MUNICIPAL_TYPES[code].fr;
            } else if (CSD_TYPES[typeCode]) {
                typeEn = CSD_TYPES[typeCode].en;
                typeFr = CSD_TYPES[typeCode].fr;
            }
            placeId = code === '3518013'
                ? 'ca-on-oshawa'
                : 'sgc-csd-' + code;
        }

        if (!placeId) continue;

        const provCodeForPlace = code.slice(0, 2);
        const provinceAbbr = PROVINCES[provCodeForPlace] || (kind === 'province' ? PROVINCES[code] : null);

        let slug = slugify(nameEn || nameFr);
        if (kind === 'province' && provinceAbbr) {
            slug = provinceAbbr.toLowerCase();
        } else if (kind === 'country') {
            slug = 'canada';
        }

        const featured = FEATURED_PLACES[placeId];
        let isFeatured = false;
        let bbox = null;
        let center = null;
        let defaultZoom = null;

        if (featured) {
            isFeatured = true;
            slug = featured.slug;
            bbox = featured.bbox;
            center = featured.center;
            defaultZoom = featured.zoom;
        }

        if (SINGLE_TIER_CITY_CSD[code]) {
            identifiers.push({
                place_id: SINGLE_TIER_CITY_CSD[code],
                scheme: 'sgc_csd',
                identifier: code
            });
            continue;
        }

        places.push({
            id: placeId,
            kind: kind,
            parent_id: parentId,
            slug: slug,
            name_en: nameEn || nameFr,
            name_fr: nameFr || nameEn,
            province_abbr: provinceAbbr,
            type_en: typeEn,
            type_fr: typeFr,
            is_featured: isFeatured,
            bbox: bbox,
            center: center,
            default_zoom: defaultZoom
        });

        if (level === '2') {
            identifiers.push({ place_id: placeId, scheme: 'sgc_p', identifier: code });
        } else if (level === '3') {
            identifiers.push({ place_id: placeId, scheme: 'sgc_cd', identifier: code });
        } else if (level === '4') {
            identifiers.push({ place_id: placeId, scheme: 'sgc_csd', identifier: code });
        }
    }

    return { places, identifiers };
}

module.exports = {
    PROVINCES,
    PROVINCE_NAMES,
    CSD_TYPES,
    SGC_MUNICIPAL_TYPES,
    SINGLE_TIER_CITY_CD,
    SINGLE_TIER_CITY_CSD,
    FEATURED_PLACES,
    slugify,
    parseSgcHierarchy
};
