const TORONTO_PUBLISHERS = [
    /^city of toronto$/i,
    /^city of toronto;\s*city clerk's office;\s*corporate records and information management$/i,
    /^city of toronto;\s*city planning;\s*policy and research$/i,
    /^city of toronto;\s*corporate services;\s*customer experience$/i,
    /^city of toronto;\s*corporate services;\s*technology and innovation$/i,
    /^city of toronto;\s*corporate services;\s*technology and transformation$/i,
    /^city of toronto;\s*corporate services;\s*technology &\s*transformation$/i,
    /^city of toronto;\s*economic development and culture;\s*arts and culture$/i,
    /^city of toronto;\s*economic development and culture;\s*business growth and services$/i,
    /^city of toronto;\s*economic development and culture;\s*program support$/i,
    /^city of toronto;\s*employment and social services;\s*social policy, analysis and research$/i,
    /^city of toronto;\s*environment and climate;\s*environment and energy$/i,
    /^city of toronto;\s*engineering and construction services;\s*engineering review$/i,
    /^city of toronto;\s*fire services;\s*professional development and accreditation$/i,
    /^city of toronto;\s*housing secretariat;\s*housing development and improvement$/i,
    /^city of toronto;\s*municipal licensing and standards;\s*policy and strategic support$/i,
    /^city of toronto;\s*parks, forestry and recreation;\s*management services$/i,
    /^city of toronto;\s*parks, forestry and recreation;\s*parks$/i,
    /^city of toronto;\s*parks, forestry and recreation;\s*policy, strategy and innovation$/i,
    /^city of toronto;\s*parks, forestry and recreation;\s*urban forestry$/i,
    /^city of toronto;\s*shelter, support and housing administration;\s*homelessness initiatives and prevention services$/i,
    /^city of toronto;\s*social development, finance and administration;\s*community resources$/i,
    /^city of toronto;\s*social development, finance and administration;\s*financial planning and management$/i,
    /^city of toronto;\s*social development, finance and administration;\s*policy, planning and research$/i,
    /^city of toronto;\s*social development, finance and administration;\s*social policy, analysis and research$/i,
    /^city of toronto;\s*toronto building;\s*customer service$/i,
    /^city of toronto;\s*toronto public health;\s*health protection$/i,
    /^city of toronto;\s*toronto public health;\s*office of the medical officer of health$/i,
    /^city of toronto;\s*toronto public health;\s*strategy and preventative health$/i,
    /^city of toronto;\s*toronto public library$/i,
    /^city of toronto;\s*toronto water;\s*business and customer services$/i,
    /^city of toronto;\s*toronto water;\s*operational support$/i,
    /^city of toronto;\s*transportation services;\s*cycling and pedestrian projects$/i,
    /^city of toronto;\s*transportation services;\s*infrastructure and policy$/i,
    /^city of toronto;\s*transportation services;\s*operations and maintenance$/i,
    /^city of toronto;\s*transportation services;\s*permits and enforcement$/i,
    /^city of toronto;\s*transportation services;\s*policy and innovation$/i,
    /^city of toronto;\s*transportation services;\s*traffic management$/i,
    /^city of toronto;\s*transportation services;\s*traffic operations$/i,
    /^city of toronto;\s*transportation services;\s*transportation infrastructure management$/i,
    /^city of toronto;\s*transportation services;\s*work zone coordination and traffic mitigation$/i
];

const AJAX_LICENSE = {
    titleEn: 'Town of Ajax Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville d’Ajax',
    url: 'https://open-data-ajax.opendata.arcgis.com/pages/licence-agreement',
    attributionEn: 'Contains information made available under the Town of Ajax Open Data Licence.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de la Ville d’Ajax.'
};

const PICKERING_LICENSE = {
    titleEn: 'City of Pickering Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Pickering',
    url: 'https://data.pickering.ca/pages/license-agreement',
    attributionEn: 'Contains information made available under the City of Pickering Open Data Licence.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de la Ville de Pickering.'
};

const WHITBY_LICENSE = {
    titleEn: 'Town of Whitby Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Whitby',
    url: 'https://opendata.whitby.ca/pages/license-agreement',
    attributionEn: 'Contains information made available under the Town of Whitby Open Data Licence.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de la Ville de Whitby.'
};

const CLOCA_LICENSE = {
    titleEn: 'Central Lake Ontario Conservation Authority Open Data Licence',
    titleFr: 'Licence de données ouvertes de l’Office de protection de la nature de Central Lake Ontario',
    url: 'https://cloca-opendata-cloca.hub.arcgis.com/pages/license-agreement',
    attributionEn: 'Contains information made available under the Central Lake Ontario Conservation Authority Open Data Licence.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de l’Office de protection de la nature de Central Lake Ontario.'
};

const ONTARIO_LICENSE = {
    titleEn: 'Open Government Licence – Ontario',
    titleFr: 'Licence du gouvernement ouvert – Ontario',
    url: 'https://www.ontario.ca/page/open-government-licence-ontario',
    attributionEn: 'Contains information licensed under the Open Government Licence – Ontario.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Ontario.'
};

const TORONTO_LICENSE = {
    titleEn: 'Open Government Licence – Toronto',
    titleFr: 'Licence du gouvernement ouvert – Toronto',
    url: 'https://open.toronto.ca/open-data-license/',
    attributionEn: 'Contains information licensed under the Open Government Licence – Toronto.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Toronto.'
};

const MONTREAL_LICENSE = {
    titleEn: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    titleFr: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attributionEn: 'Contains information licensed under Creative Commons Attribution 4.0 International.',
    attributionFr: 'Contient des renseignements visés par la licence Creative Commons Attribution 4.0 International.'
};

const QUEBEC_CITY_LICENSE = {
    titleEn: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    titleFr: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attributionEn: 'Contains information licensed under Creative Commons Attribution 4.0 International (Ville de Québec).',
    attributionFr: 'Contient des renseignements visés par la licence Creative Commons Attribution 4.0 International (Ville de Québec).'
};

const LAVAL_LICENSE = {
    titleEn: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    titleFr: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attributionEn: 'Contains information licensed under Creative Commons Attribution 4.0 International (Ville de Laval).',
    attributionFr: 'Contient des renseignements visés par la licence Creative Commons Attribution 4.0 International (Ville de Laval).'
};

const OTTAWA_LICENSE = {
    titleEn: 'Open Government Licence – City of Ottawa',
    titleFr: 'Licence du gouvernement ouvert – Ville d’Ottawa',
    url: 'https://open.ottawa.ca/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the Open Government Licence – City of Ottawa.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Ville d’Ottawa.'
};

const OTTAWA_POLICE_LICENSE = {
    titleEn: 'Open Government Licence – Ottawa Police Service',
    titleFr: 'Licence du gouvernement ouvert – Service de police d’Ottawa',
    url: 'https://data.ottawapolice.ca/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the Open Government Licence – Ottawa Police Service.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Service de police d’Ottawa.'
};

const VANCOUVER_LICENSE = {
    titleEn: 'Open Government Licence – Vancouver',
    titleFr: 'Licence du gouvernement ouvert – Vancouver',
    url: 'https://opendata.vancouver.ca/pages/licence/',
    attributionEn: 'Contains information licensed under the Open Government Licence – Vancouver.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Vancouver.'
};

const CALGARY_LICENSE = {
    titleEn: 'Open Government Licence – City of Calgary',
    titleFr: 'Licence du gouvernement ouvert – Ville de Calgary',
    url: 'https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/e65p-hxjp',
    attributionEn: 'Contains information licensed under the Open Government Licence – City of Calgary.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Ville de Calgary.'
};

const EDMONTON_LICENSE = {
    titleEn: 'Open Data City of Edmonton Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville d’Edmonton',
    url: 'https://data.edmonton.ca/stories/s/Open-Data-City-of-Edmonton-Terms-of-Use/5p2x-q4i2',
    attributionEn: 'Contains information licensed under the Open Data City of Edmonton Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les Conditions d’utilisation des données ouvertes de la Ville d’Edmonton.'
};

const WINNIPEG_LICENSE = {
    titleEn: 'City of Winnipeg Open Data Licence Agreement',
    titleFr: 'Entente de licence de données ouvertes de la Ville de Winnipeg',
    url: 'https://data.winnipeg.ca/stories/s/Open-Data-Licence-Agreement/264p-4ph5',
    attributionEn: 'Contains information licensed under the City of Winnipeg Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Entente de licence de données ouvertes de la Ville de Winnipeg.'
};

const HALIFAX_LICENSE = {
    titleEn: 'Open Data Terms of Use – Halifax Regional Municipality',
    titleFr: 'Conditions d’utilisation des données ouvertes – Municipalité régionale d’Halifax',
    url: 'https://www.halifax.ca/home/open-data/open-data-terms-use',
    attributionEn: 'Contains information licensed under the Open Data Terms of Use – Halifax Regional Municipality.',
    attributionFr: 'Contient des renseignements visés par les Conditions d’utilisation des données ouvertes – Municipalité régionale d’Halifax.'
};

const HAMILTON_LICENSE = {
    titleEn: 'City of Hamilton Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Hamilton',
    url: 'https://www.hamilton.ca/city-council/data-maps/open-data/open-data-licence-terms-and-conditions',
    attributionEn: 'Contains public sector Data made available under the City of Hamilton’s Open Data Licence',
    attributionFr: 'Contient des données du secteur public fournies selon la licence de données ouvertes de la Ville de Hamilton.'
};

const SURREY_LICENSE = {
    titleEn: 'City of Surrey Open Government Licence',
    titleFr: 'Licence du gouvernement ouvert de la Ville de Surrey',
    url: 'https://cosmos.surrey.ca/data/Open_Government_License.html',
    attributionEn: 'Contains information licensed under the City of Surrey Open Government Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert de la Ville de Surrey.'
};

const MISSISSAUGA_LICENSE = {
    titleEn: 'City of Mississauga Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville de Mississauga',
    url: 'https://data.mississauga.ca/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Mississauga Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville de Mississauga.'
};

const CC_BY_4_LICENSE = {
    titleEn: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    titleFr: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attributionEn: 'Contains information licensed under Creative Commons Attribution 4.0 International.',
    attributionFr: 'Contient des renseignements visés par la licence Creative Commons Attribution 4.0 International.'
};

const OGL_CANADA_LICENSE = {
    titleEn: 'Open Government Licence – Canada',
    titleFr: 'Licence du gouvernement ouvert – Canada',
    url: 'https://open.canada.ca/en/open-government-licence-canada',
    attributionEn: 'Contains information licensed under the Open Government Licence – Canada.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Canada.'
};

const STATCAN_LICENSE = {
    titleEn: 'Statistics Canada Open Licence',
    titleFr: 'Licence ouverte de Statistique Canada',
    url: 'https://www.statcan.gc.ca/en/reference/licence',
    attributionEn: 'Contains information licensed under the Statistics Canada Open Licence.',
    attributionFr: 'Contient des renseignements visés par la licence ouverte de Statistique Canada.'
};

const PEEL_LICENSE = {
    titleEn: 'Region of Peel Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la région de Peel',
    url: 'https://data.peelregion.ca/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the Region of Peel Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la région de Peel.'
};

const VICTORIA_LICENSE = {
    titleEn: 'Open Data Licence Agreement – City of Victoria',
    titleFr: 'Accord de licence de données ouvertes – Ville de Victoria',
    url: 'https://opendata.victoria.ca/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the Open Data Licence Agreement – City of Victoria.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes – Ville de Victoria.'
};

const WATERLOO_REGION_LICENSE = {
    titleEn: 'Region of Waterloo Open Data Licence Agreement',
    titleFr: 'Accord de licence de données ouvertes de la Région de Waterloo',
    url: 'https://rowopendata-rmw.opendata.arcgis.com/pages/licence-agreement',
    attributionEn: 'Contains information licensed under the Region of Waterloo Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes de la Région de Waterloo.'
};

const LONDON_LICENSE = {
    titleEn: 'City of London Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de London',
    url: 'https://open.london.ca/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the City of London Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de London.'
};

const KELOWNA_LICENSE = {
    titleEn: 'City of Kelowna Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville de Kelowna',
    url: 'https://opendata.kelowna.ca/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Kelowna Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville de Kelowna.'
};

const FREDERICTON_LICENSE = {
    titleEn: 'Open Data Licence – City of Fredericton',
    titleFr: 'Licence de données ouvertes – Ville de Fredericton',
    url: 'http://fredericton.ca/en/open-data-licence',
    attributionEn: 'Contains information licensed under the Open Data Licence – City of Fredericton.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes – Ville de Fredericton.'
};

const BURLINGTON_LICENSE = {
    titleEn: 'City of Burlington Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville de Burlington',
    url: 'https://navburl-burlington.opendata.arcgis.com/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Burlington Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville de Burlington.'
};

const OAKVILLE_LICENSE = {
    titleEn: 'Town of Oakville Open Data Licence Agreement',
    titleFr: 'Accord de licence de données ouvertes de la Ville d’Oakville',
    url: 'https://oakville.opendata.arcgis.com/pages/licence-agreement',
    attributionEn: 'Contains information licensed under the Town of Oakville Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes de la Ville d’Oakville.'
};

const MILTON_LICENSE = {
    titleEn: 'Town of Milton Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Milton',
    url: 'https://data-milton.opendata.arcgis.com/pages/license',
    attributionEn: 'Contains information licensed under the Town of Milton Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Milton.'
};

const SUDBURY_LICENSE = {
    titleEn: 'City of Greater Sudbury Open Data Policy and Licence',
    titleFr: 'Politique et licence de données ouvertes de la Ville du Grand Sudbury',
    url: 'https://opendata.greatersudbury.ca/pages/open-data-policy',
    attributionEn: 'Contains information licensed under the City of Greater Sudbury Open Data Policy and Licence.',
    attributionFr: 'Contient des renseignements visés par la Politique et licence de données ouvertes de la Ville du Grand Sudbury.'
};

const BURNABY_LICENSE = {
    titleEn: 'City of Burnaby Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Burnaby',
    url: 'https://data.burnaby.ca/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the City of Burnaby Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Burnaby.'
};

const SASKATOON_LICENSE = {
    titleEn: 'City of Saskatoon Open Data Licence Agreement',
    titleFr: 'Accord de licence de données ouvertes de la Ville de Saskatoon',
    url: 'https://open-data-saskatoon.hub.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the City of Saskatoon Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes de la Ville de Saskatoon.'
};

const YORK_REGION_LICENSE = {
    titleEn: 'The Regional Municipality of York Open Data Licence',
    titleFr: 'Licence de données ouvertes de la municipalité régionale de York',
    url: 'https://york-region-open-data-yorkgis.hub.arcgis.com/pages/open-data-licence',
    attributionEn: 'Contains information licensed under The Regional Municipality of York Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la municipalité régionale de York.'
};

const MARKHAM_LICENSE = {
    titleEn: 'City of Markham Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Markham',
    url: 'https://data-markham.opendata.arcgis.com/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the City of Markham Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Markham.'
};

const NEWMARKET_LICENSE = {
    titleEn: 'Town of Newmarket Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Newmarket',
    url: 'https://data-newmarket.opendata.arcgis.com/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the Town of Newmarket Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Newmarket.'
};

const NIAGARA_FALLS_LICENSE = {
    titleEn: 'City of Niagara Falls Open Data Licence Agreement',
    titleFr: 'Accord de licence de données ouvertes de la Ville de Niagara Falls',
    url: 'https://open.niagarafalls.ca/pages/licence-agreement',
    attributionEn: 'Contains information licensed under the City of Niagara Falls Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes de la Ville de Niagara Falls.'
};

const WELLAND_LICENSE = {
    titleEn: 'City of Welland Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Welland',
    url: 'https://open-welland.opendata.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the City of Welland Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Welland.'
};

const MONCTON_LICENSE = {
    titleEn: 'City of Moncton Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Moncton',
    url: 'https://open-data-cityofmoncton.hub.arcgis.com/pages/open-data-licence',
    attributionEn: 'Contains information licensed under the City of Moncton Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Moncton.'
};

const GUELPH_LICENSE = {
    titleEn: 'City of Guelph Open Data Licence Agreement',
    titleFr: 'Accord de licence de données ouvertes de la Ville de Guelph',
    url: 'https://open-guelph.opendata.arcgis.com/pages/licence-agreement',
    attributionEn: 'Contains information licensed under the City of Guelph Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes de la Ville de Guelph.'
};

const SAANICH_LICENSE = {
    titleEn: 'District of Saanich Open Data Licence',
    titleFr: 'Licence de données ouvertes du district de Saanich',
    url: 'https://data-saanich.opendata.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the District of Saanich Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes du district de Saanich.'
};

const BELLEVILLE_LICENSE = {
    titleEn: 'City of Belleville Open Data Licence Agreement',
    titleFr: 'Accord de licence de données ouvertes de la Ville de Belleville',
    url: 'https://data-cityofbelleville.opendata.arcgis.com/pages/licence-agreement',
    attributionEn: 'Contains information licensed under the City of Belleville Open Data Licence Agreement.',
    attributionFr: 'Contient des renseignements visés par l’Accord de licence de données ouvertes de la Ville de Belleville.'
};

const YELLOWKNIFE_LICENSE = {
    titleEn: 'City of Yellowknife Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville de Yellowknife',
    url: 'https://data-yellowknife.hub.arcgis.com/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Yellowknife Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville de Yellowknife.'
};

const BARRIE_LICENSE = {
    titleEn: 'The Corporation of the City of Barrie Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Corporation de la Ville de Barrie',
    url: 'https://opendata.barrie.ca/pages/terms-of-use',
    attributionEn: 'Contains information licensed under The Corporation of the City of Barrie Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Corporation de la Ville de Barrie.'
};

const THUNDER_BAY_LICENSE = {
    titleEn: 'City of Thunder Bay Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Thunder Bay',
    url: 'https://opendata-thunderbay.hub.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the City of Thunder Bay Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Thunder Bay.'
};

const CHATHAM_KENT_LICENSE = {
    titleEn: 'Municipality of Chatham-Kent Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la municipalité de Chatham-Kent',
    url: 'https://opendata.chatham-kent.ca/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the Municipality of Chatham-Kent Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la municipalité de Chatham-Kent.'
};

const KAWARTHA_LAKES_LICENSE = {
    titleEn: 'City of Kawartha Lakes Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville de Kawartha Lakes',
    url: 'https://open-data-kawartha.hub.arcgis.com/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Kawartha Lakes Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville de Kawartha Lakes.'
};

const SUMMERLAND_LICENSE = {
    titleEn: 'The Corporation of the District of Summerland Open Government Licence',
    titleFr: 'Licence du gouvernement ouvert de la Corporation du district de Summerland',
    url: 'https://open-data-summerland.hub.arcgis.com/pages/open-government-licence',
    attributionEn: 'Contains information licensed under The Corporation of the District of Summerland Open Government Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert de la Corporation du district de Summerland.'
};

const NORFOLK_LICENSE = {
    titleEn: 'Norfolk County Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes du comté de Norfolk',
    url: 'https://data-norfolk.opendata.arcgis.com/pages/terms-of-use',
    attributionEn: 'Contains information licensed by The Corporation of Norfolk County.',
    attributionFr: 'Contient des renseignements fournis par la Corporation du comté de Norfolk.'
};

const HALDIMAND_LICENSE = {
    titleEn: 'Haldimand County Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes du comté de Haldimand',
    url: 'https://opendata-haldimand.hub.arcgis.com/',
    attributionEn: 'Contains information licensed by The Corporation of Haldimand County.',
    attributionFr: 'Contient des renseignements fournis par la Corporation du comté de Haldimand.'
};

const LETHBRIDGE_LICENSE = {
    titleEn: 'City of Lethbridge Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville de Lethbridge',
    url: 'https://opendata.lethbridge.ca/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Lethbridge Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville de Lethbridge.'
};

const MEDICINE_HAT_LICENSE = {
    titleEn: 'City of Medicine Hat Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Medicine Hat',
    url: 'https://opendata.medicinehat.ca/pages/licence',
    attributionEn: 'Contains information licensed under the City of Medicine Hat Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Medicine Hat.'
};

const AIRDRIE_LICENSE = {
    titleEn: 'City of Airdrie Open Data Terms of Use',
    titleFr: 'Conditions d’utilisation des données ouvertes de la Ville d’Airdrie',
    url: 'https://data-airdrie.opendata.arcgis.com/pages/terms-of-use',
    attributionEn: 'Contains information licensed under the City of Airdrie Open Data Terms of Use.',
    attributionFr: 'Contient des renseignements visés par les conditions d’utilisation des données ouvertes de la Ville d’Airdrie.'
};

const CANMORE_LICENSE = {
    titleEn: 'Town of Canmore Open Data Terms',
    titleFr: 'Conditions des données ouvertes de la Ville de Canmore',
    url: 'https://opendata-canmore.opendata.arcgis.com/pages/terms',
    attributionEn: 'Contains information licensed under the Town of Canmore Open Data Terms.',
    attributionFr: 'Contient des renseignements visés par les conditions des données ouvertes de la Ville de Canmore.'
};

const PENTICTON_LICENSE = {
    titleEn: 'City of Penticton Open Data Terms',
    titleFr: 'Conditions des données ouvertes de la Ville de Penticton',
    url: 'https://open.penticton.ca/pages/terms',
    attributionEn: 'Contains information licensed under the City of Penticton Open Data Terms.',
    attributionFr: 'Contient des renseignements visés par les conditions des données ouvertes de la Ville de Penticton.'
};

const LANGLEY_CITY_LICENSE = {
    titleEn: 'City of Langley Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville de Langley',
    url: 'https://data-langleycity.opendata.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the City of Langley Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la Ville de Langley.'
};

const HURON_LICENSE = {
    titleEn: 'County of Huron Open Data Licence',
    titleFr: 'Licence de données ouvertes du comté de Huron',
    url: 'https://data-huron.opendata.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the County of Huron Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes du comté de Huron.'
};

const CUMBERLAND_LICENSE = {
    titleEn: 'Municipality of the County of Cumberland Open Data Licence',
    titleFr: 'Licence de données ouvertes de la municipalité du comté de Cumberland',
    url: 'https://data-cumberlandns.opendata.arcgis.com/pages/licence',
    attributionEn: 'Contains information licensed under the Municipality of the County of Cumberland Open Data Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence de données ouvertes de la municipalité du comté de Cumberland.'
};

const DURHAM_PUBLISHER = /^regional municipality of durham$/i;
const HALTON_PUBLISHER = /^regional municipality of halton$/i;

// Match Hamilton Open Data publisher names while ignoring internal and external partner
// paths. Keep the allowlist fail-closed: an unfamiliar publisher string must be
// reviewed before portal-wide City terms can be applied to it.
const HAMILTON_PUBLISHER_PATTERNS = [
    /^city of hamilton$/i,
    /^city of hamilton;\s*corporate services;\s*information technology$/i,
    /^city of hamilton;\s*planning and economic development;\s*planning$/i,
    /^city of hamilton;\s*planning and economic development;\s*growth management$/i,
    /^city of hamilton;\s*planning and economic development;\s*development planning$/i,
    /^city of hamilton;\s*planning and economic development;\s*transportation planning$/i,
    /^city of hamilton;\s*public works;\s*transit$/i,
    /^city of hamilton;\s*public works;\s*water and wastewater$/i,
    /^city of hamilton;\s*public works;\s*roads and traffic$/i,
    /^city of hamilton;\s*public works;\s*waste management$/i,
    /^city of hamilton;\s*healthy and safe communities;\s*public health services$/i,
    /^city of hamilton;\s*healthy and safe communities;\s*housing services$/i,
    /^city of hamilton;\s*healthy and safe communities;\s*recreation$/i
];

const sources = [{
    id: 'toronto-open-data',
    kind: 'ckan',
    nameEn: 'City of Toronto Open Data',
    nameFr: 'Données ouvertes de la Ville de Toronto',
    homepageUrl: 'https://open.toronto.ca/',
    catalogUrl: 'https://ckan0.cf.opendata.inter.prod-toronto.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: TORONTO_PUBLISHERS.map(pattern => ({
        publisher: pattern,
        name: 'City of Toronto'
    })),
    authoritativePublishers: TORONTO_PUBLISHERS.map(pattern => ({
        publisher: pattern
    })),
    licenseRules: TORONTO_PUBLISHERS.map(pattern => ({
        publisher: pattern,
        license: TORONTO_LICENSE
    })),
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3520',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'montreal-open-data',
    kind: 'ckan',
    nameEn: 'Données ouvertes – Ville de Montréal',
    nameFr: 'Données ouvertes – Ville de Montréal',
    homepageUrl: 'https://donnees.montreal.ca/',
    catalogUrl: 'https://donnees.montreal.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^ville de montréal$/i, name: 'Ville de Montréal' },
        { publisher: /^ville de montreal$/i, name: 'Ville de Montréal' },
        { publisher: /^city of montreal$/i, name: 'Ville de Montréal' },
        { publisher: /^{{source}}$/i, name: 'Ville de Montréal' }
    ],
    authoritativePublishers: [
        { publisher: /^ville de montréal$/i },
        { publisher: /^ville de montreal$/i },
        { publisher: /^city of montreal$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^ville de montréal$/i, license: MONTREAL_LICENSE },
        { publisher: /^ville de montreal$/i, license: MONTREAL_LICENSE },
        { publisher: /^city of montreal$/i, license: MONTREAL_LICENSE },
        { publisher: /^{{source}}$/i, license: MONTREAL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', license: MONTREAL_LICENSE },
        { licenseUrl: 'http://creativecommons.org/licenses/by/4.0/', license: MONTREAL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.fr', license: MONTREAL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.en', license: MONTREAL_LICENSE },
        { licenseTitle: /^cc-by$/i, license: MONTREAL_LICENSE },
        { licenseTitle: /^cc by 4\.0$/i, license: MONTREAL_LICENSE },
        { licenseTitle: /^creative commons attribution 4\.0/i, license: MONTREAL_LICENSE },
        { licenseTitle: /^attribution 4\.0 international/i, license: MONTREAL_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-2466023',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'quebec-city-open-data',
    kind: 'ckan',
    nameEn: 'Données ouvertes – Ville de Québec',
    nameFr: 'Données ouvertes – Ville de Québec',
    homepageUrl: 'https://www.donneesquebec.ca/recherche/organization/ville-de-quebec',
    catalogUrl: 'https://www.donneesquebec.ca/recherche',
    catalogFilter: {
        owner_org: 'ville-de-quebec'
    },
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^ville de québec$/i, name: 'Ville de Québec' },
        { publisher: /^ville de quebec$/i, name: 'Ville de Québec' },
        { publisher: /^city of quebec$/i, name: 'Ville de Québec' },
        { publisher: /^{{source}}$/i, name: 'Ville de Québec' }
    ],
    authoritativePublishers: [
        { publisher: /^ville de québec$/i },
        { publisher: /^ville de quebec$/i },
        { publisher: /^city of quebec$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^ville de québec$/i, license: QUEBEC_CITY_LICENSE },
        { publisher: /^ville de quebec$/i, license: QUEBEC_CITY_LICENSE },
        { publisher: /^city of quebec$/i, license: QUEBEC_CITY_LICENSE },
        { publisher: /^{{source}}$/i, license: QUEBEC_CITY_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', license: QUEBEC_CITY_LICENSE },
        { licenseUrl: 'http://creativecommons.org/licenses/by/4.0/', license: QUEBEC_CITY_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.fr', license: QUEBEC_CITY_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.en', license: QUEBEC_CITY_LICENSE },
        { licenseTitle: /^cc-by$/i, license: QUEBEC_CITY_LICENSE },
        { licenseTitle: /^cc by 4\.0$/i, license: QUEBEC_CITY_LICENSE },
        { licenseTitle: /^creative commons attribution 4\.0/i, license: QUEBEC_CITY_LICENSE },
        { licenseTitle: /^attribution 4\.0 international/i, license: QUEBEC_CITY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-2423027',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'laval-open-data',
    kind: 'ckan',
    nameEn: 'Données ouvertes – Ville de Laval',
    nameFr: 'Données ouvertes – Ville de Laval',
    homepageUrl: 'https://www.donneesquebec.ca/recherche/organization/ville-de-laval',
    catalogUrl: 'https://www.donneesquebec.ca/recherche',
    catalogFilter: {
        owner_org: 'ville-de-laval'
    },
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^ville de laval$/i, name: 'Ville de Laval' },
        { publisher: /^city of laval$/i, name: 'Ville de Laval' },
        { publisher: /^{{source}}$/i, name: 'Ville de Laval' }
    ],
    authoritativePublishers: [
        { publisher: /^ville de laval$/i },
        { publisher: /^city of laval$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^ville de laval$/i, license: LAVAL_LICENSE },
        { publisher: /^city of laval$/i, license: LAVAL_LICENSE },
        { publisher: /^{{source}}$/i, license: LAVAL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', license: LAVAL_LICENSE },
        { licenseUrl: 'http://creativecommons.org/licenses/by/4.0/', license: LAVAL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.fr', license: LAVAL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.en', license: LAVAL_LICENSE },
        { licenseTitle: /^cc-by$/i, license: LAVAL_LICENSE },
        { licenseTitle: /^cc by 4\.0$/i, license: LAVAL_LICENSE },
        { licenseTitle: /^creative commons attribution 4\.0/i, license: LAVAL_LICENSE },
        { licenseTitle: /^attribution 4\.0 international/i, license: LAVAL_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-2465',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'ottawa-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Ottawa Open Data',
    nameFr: 'Données ouvertes de la Ville d’Ottawa',
    homepageUrl: 'https://open.ottawa.ca/',
    catalogUrl: 'https://open.ottawa.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open.ottawa.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of ottawa$/i, name: 'City of Ottawa' },
        { publisher: /^ottawa police service$/i, name: 'Ottawa Police Service' },
        { publisher: /^{{source}}$/i, name: 'City of Ottawa' }
    ],
    authoritativePublishers: [
        { publisher: /^city of ottawa$/i },
        { publisher: /^ottawa police service$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of ottawa$/i, license: OTTAWA_LICENSE },
        { publisher: /^{{source}}$/i, license: OTTAWA_LICENSE },
        { publisher: /^ottawa police service$/i, license: OTTAWA_POLICE_LICENSE },
        { licensePattern: /data\.ottawapolice\.ca\/pages\/open-data-licence/i, license: OTTAWA_POLICE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3506',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'vancouver-open-data',
    kind: 'opendatasoft',
    nameEn: 'City of Vancouver Open Data',
    nameFr: 'Données ouvertes de la Ville de Vancouver',
    homepageUrl: 'https://opendata.vancouver.ca/',
    catalogUrl: 'https://opendata.vancouver.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of vancouver$/i, name: 'City of Vancouver' },
        { publisher: /^{{source}}$/i, name: 'City of Vancouver' }
    ],
    authoritativePublishers: [
        { publisher: /^city of vancouver$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of vancouver$/i, license: VANCOUVER_LICENSE },
        { publisher: /^{{source}}$/i, license: VANCOUVER_LICENSE },
        { licenseUrl: 'https://opendata.vancouver.ca/pages/licence/', license: VANCOUVER_LICENSE },
        { licenseTitle: /^open government licence\s*[-–—]\s*vancouver$/i, license: VANCOUVER_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5915022',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'calgary-open-data',
    kind: 'socrata',
    nameEn: 'Open Calgary',
    nameFr: 'Données ouvertes de Calgary',
    homepageUrl: 'https://data.calgary.ca/',
    catalogUrl: 'https://data.calgary.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of calgary$/i, name: 'City of Calgary' },
        { publisher: /^{{source}}$/i, name: 'City of Calgary' }
    ],
    authoritativePublishers: [
        { publisher: /^city of calgary$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of calgary$/i, license: CALGARY_LICENSE },
        { publisher: /^{{source}}$/i, license: CALGARY_LICENSE },
        { licenseUrl: 'https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/e65p-hxjp', license: CALGARY_LICENSE },
        { licenseTitle: /^open calgary terms of use$/i, license: CALGARY_LICENSE },
        { licenseTitle: /^open government licence\s*[-–—]\s*city of calgary$/i, license: CALGARY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4806016',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'edmonton-open-data',
    kind: 'socrata',
    nameEn: 'City of Edmonton Open Data',
    nameFr: 'Données ouvertes de la Ville d’Edmonton',
    homepageUrl: 'https://data.edmonton.ca/',
    catalogUrl: 'https://data.edmonton.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of edmonton$/i, name: 'City of Edmonton' },
        { publisher: /^{{source}}$/i, name: 'City of Edmonton' }
    ],
    authoritativePublishers: [
        { publisher: /^city of edmonton$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of edmonton$/i, license: EDMONTON_LICENSE },
        { publisher: /^{{source}}$/i, license: EDMONTON_LICENSE },
        { licenseUrl: 'https://data.edmonton.ca/stories/s/Open-Data-City-of-Edmonton-Terms-of-Use/5p2x-q4i2', license: EDMONTON_LICENSE },
        { licenseTitle: /^open data city of edmonton terms of use$/i, license: EDMONTON_LICENSE },
        { licenseTitle: /^open government licence\s*[-–—]\s*city of edmonton$/i, license: EDMONTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4811061',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'winnipeg-open-data',
    kind: 'socrata',
    nameEn: 'City of Winnipeg Open Data',
    nameFr: 'Données ouvertes de la Ville de Winnipeg',
    homepageUrl: 'https://data.winnipeg.ca/',
    catalogUrl: 'https://data.winnipeg.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of winnipeg$/i, name: 'City of Winnipeg' },
        { publisher: /^{{source}}$/i, name: 'City of Winnipeg' }
    ],
    authoritativePublishers: [
        { publisher: /^city of winnipeg$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of winnipeg$/i, license: WINNIPEG_LICENSE },
        { publisher: /^{{source}}$/i, license: WINNIPEG_LICENSE },
        { licenseUrl: 'https://data.winnipeg.ca/stories/s/Open-Data-Licence-Agreement/264p-4ph5', license: WINNIPEG_LICENSE },
        { licenseTitle: /^open data licence agreement$/i, license: WINNIPEG_LICENSE },
        { licenseTitle: /^city of winnipeg open data licence agreement$/i, license: WINNIPEG_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4611040',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'halifax-hub',
    kind: 'arcgis-hub',
    nameEn: 'Halifax Open Data',
    nameFr: 'Données ouvertes d’Halifax',
    homepageUrl: 'https://catalogue-hrm.opendata.arcgis.com/',
    catalogUrl: 'https://catalogue-hrm.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'catalogue-hrm.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^halifax regional municipality$/i, name: 'Halifax Regional Municipality' },
        { publisher: /^hrm$/i, name: 'Halifax Regional Municipality' },
        { publisher: /^{{source}}$/i, name: 'Halifax Regional Municipality' }
    ],
    authoritativePublishers: [
        { publisher: /^halifax regional municipality$/i },
        { publisher: /^hrm$/i }
    ],
    licenseRules: [
        { publisher: /^halifax regional municipality$/i, license: HALIFAX_LICENSE },
        { publisher: /^hrm$/i, license: HALIFAX_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-1209034',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'hamilton-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Hamilton Open Data',
    nameFr: 'Données ouvertes de la Ville de Hamilton',
    homepageUrl: 'https://open.hamilton.ca/',
    catalogUrl: 'https://open.hamilton.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open.hamilton.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        ...HAMILTON_PUBLISHER_PATTERNS.map(pattern => ({
            publisher: pattern,
            name: 'City of Hamilton'
        })),
        { publisher: /^{{source}}$/i, name: 'City of Hamilton' }
    ],
    authoritativePublishers: HAMILTON_PUBLISHER_PATTERNS.map(pattern => ({ publisher: pattern })),
    licenseRules: [
        ...HAMILTON_PUBLISHER_PATTERNS.map(pattern => ({
            publisher: pattern,
            license: HAMILTON_LICENSE
        })),
        { publisher: /^{{source}}$/i, license: HAMILTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3525',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'surrey-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Surrey Open Data',
    nameFr: 'Données ouvertes de la Ville de Surrey',
    homepageUrl: 'https://data.surrey.ca/',
    catalogUrl: 'https://data.surrey.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data.surrey.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of surrey$/i, name: 'City of Surrey' },
        { publisher: /^{{source}}$/i, name: 'City of Surrey' }
    ],
    authoritativePublishers: [
        { publisher: /^city of surrey$/i }
    ],
    licenseRules: [
        { publisher: /^city of surrey$/i, license: SURREY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5915004',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'oshawa-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Oshawa Open Data',
    nameFr: 'Données ouvertes de la Ville d’Oshawa',
    homepageUrl: 'https://open-data-oshawa.hub.arcgis.com/',
    catalogUrl: 'https://open-data-oshawa.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-data-oshawa.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of oshawa$/i, name: 'City of Oshawa' },
        { publisher: /^{{source}}$/i, name: 'City of Oshawa' }
    ],
    authoritativePublishers: [
        { publisher: /^city of oshawa$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of oshawa$/i, license: ONTARIO_LICENSE },
        { publisher: /^{{source}}$/i, license: ONTARIO_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3518013',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'ajax-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Ajax Open Data',
    nameFr: 'Données ouvertes de la Ville d’Ajax',
    homepageUrl: 'https://open-data-ajax.opendata.arcgis.com/',
    catalogUrl: 'https://open-data-ajax.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-data-ajax.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^town of ajax$/i, name: 'Town of Ajax' },
        { publisher: /^{{source}}$/i, name: 'Town of Ajax' }
    ],
    authoritativePublishers: [
        { publisher: /^town of ajax$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^town of ajax$/i, license: AJAX_LICENSE },
        { publisher: /^{{source}}$/i, license: AJAX_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3518005',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'pickering-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Pickering Open Data',
    nameFr: 'Données ouvertes de la Ville de Pickering',
    homepageUrl: 'https://data.pickering.ca/',
    catalogUrl: 'https://data.pickering.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data.pickering.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of pickering$/i, name: 'City of Pickering' },
        { publisher: /^{{source}}$/i, name: 'City of Pickering' }
    ],
    authoritativePublishers: [
        { publisher: /^city of pickering$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of pickering$/i, license: PICKERING_LICENSE },
        { publisher: /^{{source}}$/i, license: PICKERING_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3518001',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'whitby-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Whitby Open Data',
    nameFr: 'Données ouvertes de la Ville de Whitby',
    homepageUrl: 'https://opendata.whitby.ca/',
    catalogUrl: 'https://opendata.whitby.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.whitby.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^town of whitby$/i, name: 'Town of Whitby' },
        { publisher: /^{{source}}$/i, name: 'Town of Whitby' }
    ],
    authoritativePublishers: [
        { publisher: /^town of whitby$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^town of whitby$/i, license: WHITBY_LICENSE },
        { publisher: /^{{source}}$/i, license: WHITBY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3518009',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'durham-hub',
    kind: 'arcgis-hub',
    nameEn: 'Durham Region Open Data',
    nameFr: 'Données ouvertes de la région de Durham',
    homepageUrl: 'https://open-data-durham.opendata.arcgis.com/',
    catalogUrl: 'https://open-data-durham.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-data-durham.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: DURHAM_PUBLISHER, name: 'Regional Municipality of Durham' },
        { publisher: /^town of ajax$/i, name: 'Town of Ajax' },
        { publisher: /^city of pickering$/i, name: 'City of Pickering' },
        { publisher: /^central lake ontario conservation authority$/i, name: 'Central Lake Ontario Conservation Authority' },
        { publisher: /^{{source}}$/i, name: 'Regional Municipality of Durham' }
    ],
    authoritativePublishers: [
        { publisher: DURHAM_PUBLISHER },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: DURHAM_PUBLISHER, license: ONTARIO_LICENSE },
        { publisher: /^town of ajax$/i, license: AJAX_LICENSE },
        { publisher: /^city of pickering$/i, license: PICKERING_LICENSE },
        { publisher: /^central lake ontario conservation authority$/i, license: CLOCA_LICENSE },
        { publisher: /^{{source}}$/i, license: ONTARIO_LICENSE }
    ],
    placeRules: [
        { publisher: DURHAM_PUBLISHER, placeId: 'sgc-cd-3518', relationship: 'direct', includesDescendants: true },
        { publisher: /^town of ajax$/i, placeId: 'sgc-csd-3518005', relationship: 'direct', includesDescendants: false },
        { publisher: /^city of pickering$/i, placeId: 'sgc-csd-3518001', relationship: 'direct', includesDescendants: false },
        { publisher: /^central lake ontario conservation authority$/i, placeId: 'sgc-cd-3518', relationship: 'direct', includesDescendants: true },
        { publisher: /.*/, placeId: 'sgc-cd-3518', relationship: 'direct', includesDescendants: true }
    ]
}, {
    id: 'mississauga-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Mississauga Open Data',
    nameFr: 'Données ouvertes de la Ville de Mississauga',
    homepageUrl: 'https://data.mississauga.ca/',
    catalogUrl: 'https://data.mississauga.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data.mississauga.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of mississauga$/i, name: 'City of Mississauga' },
        { publisher: /^{{source}}$/i, name: 'City of Mississauga' }
    ],
    authoritativePublishers: [
        { publisher: /^city of mississauga$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { licenseUrl: 'https://www.statcan.gc.ca/en/reference/licence', license: STATCAN_LICENSE },
        { licenseTitle: /^statistics canada open licence/i, license: STATCAN_LICENSE },
        { publisher: /^city of mississauga$/i, license: MISSISSAUGA_LICENSE },
        { publisher: /^{{source}}$/i, license: MISSISSAUGA_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3521005',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'brampton-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Brampton Open Data',
    nameFr: 'Données ouvertes de la Ville de Brampton',
    homepageUrl: 'https://geohub.brampton.ca/',
    catalogUrl: 'https://geohub.brampton.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'geohub.brampton.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of brampton$/i, name: 'City of Brampton' },
        { publisher: /^{{source}}$/i, name: 'City of Brampton' }
    ],
    authoritativePublishers: [
        { publisher: /^city of brampton$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', license: CC_BY_4_LICENSE },
        { licenseUrl: 'https://www.statcan.gc.ca/en/reference/licence', license: STATCAN_LICENSE },
        { licenseTitle: /^creative commons attribution 4\.0/i, license: CC_BY_4_LICENSE },
        { licenseTitle: /^statistics canada open licence/i, license: STATCAN_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3521010',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'peel-hub',
    kind: 'arcgis-hub',
    nameEn: 'Region of Peel Open Data',
    nameFr: 'Données ouvertes de la région de Peel',
    homepageUrl: 'https://data.peelregion.ca/',
    catalogUrl: 'https://data.peelregion.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data.peelregion.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^regional municipality of peel$/i, name: 'Regional Municipality of Peel' },
        { publisher: /^region of peel$/i, name: 'Regional Municipality of Peel' },
        { publisher: /^city of brampton$/i, name: 'City of Brampton' },
        { publisher: /^city of mississauga$/i, name: 'City of Mississauga' },
        { publisher: /^town of caledon$/i, name: 'Town of Caledon' },
        { publisher: /^{{source}}$/i, name: 'Regional Municipality of Peel' }
    ],
    authoritativePublishers: [
        { publisher: /^regional municipality of peel$/i },
        { publisher: /^region of peel$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^regional municipality of peel$/i, license: PEEL_LICENSE },
        { publisher: /^region of peel$/i, license: PEEL_LICENSE },
        { publisher: /^{{source}}$/i, license: PEEL_LICENSE },
        { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', license: CC_BY_4_LICENSE },
        { licenseUrl: 'https://open.canada.ca/en/open-government-licence-canada', license: OGL_CANADA_LICENSE },
        { licenseUrl: 'https://www.statcan.gc.ca/en/reference/licence', license: STATCAN_LICENSE },
        { licenseTitle: /^creative commons attribution 4\.0/i, license: CC_BY_4_LICENSE },
        { licenseTitle: /^open government licence\s*[-–—]\s*canada$/i, license: OGL_CANADA_LICENSE },
        { licenseTitle: /^statistics canada open licence/i, license: STATCAN_LICENSE }
    ],
    placeRules: [
        { publisher: /^city of mississauga$/i, placeId: 'sgc-csd-3521005', relationship: 'direct', includesDescendants: false },
        { publisher: /^city of brampton$/i, placeId: 'sgc-csd-3521010', relationship: 'direct', includesDescendants: false },
        { publisher: /^town of caledon$/i, placeId: 'sgc-csd-3521024', relationship: 'direct', includesDescendants: false },
        { publisher: /.*/, placeId: 'sgc-cd-3521', relationship: 'direct', includesDescendants: true }
    ]
}, {
    id: 'victoria-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Victoria Open Data',
    nameFr: 'Données ouvertes de la Ville de Victoria',
    homepageUrl: 'https://opendata.victoria.ca/',
    catalogUrl: 'https://opendata.victoria.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.victoria.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of victoria$/i, name: 'City of Victoria' },
        { publisher: /^{{source}}$/i, name: 'City of Victoria' }
    ],
    authoritativePublishers: [
        { publisher: /^city of victoria$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of victoria$/i, license: VICTORIA_LICENSE },
        { publisher: /^{{source}}$/i, license: VICTORIA_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5917034',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'waterloo-region-hub',
    kind: 'arcgis-hub',
    nameEn: 'Region of Waterloo Open Data',
    nameFr: 'Données ouvertes de la Région de Waterloo',
    homepageUrl: 'https://rowopendata-rmw.opendata.arcgis.com/',
    catalogUrl: 'https://rowopendata-rmw.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'rowopendata-rmw.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^regional municipality of waterloo$/i, name: 'Region of Waterloo' },
        { publisher: /^region of waterloo$/i, name: 'Region of Waterloo' },
        { publisher: /^city of kitchener$/i, name: 'City of Kitchener' },
        { publisher: /^city of cambridge$/i, name: 'City of Cambridge' },
        { publisher: /^city of waterloo$/i, name: 'City of Waterloo' },
        { publisher: /^{{source}}$/i, name: 'Region of Waterloo' }
    ],
    authoritativePublishers: [
        { publisher: /^regional municipality of waterloo$/i },
        { publisher: /^region of waterloo$/i },
        { publisher: /^city of kitchener$/i },
        { publisher: /^city of cambridge$/i },
        { publisher: /^city of waterloo$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^regional municipality of waterloo$/i, license: WATERLOO_REGION_LICENSE },
        { publisher: /^region of waterloo$/i, license: WATERLOO_REGION_LICENSE },
        { publisher: /^city of kitchener$/i, license: WATERLOO_REGION_LICENSE },
        { publisher: /^city of cambridge$/i, license: WATERLOO_REGION_LICENSE },
        { publisher: /^city of waterloo$/i, license: WATERLOO_REGION_LICENSE },
        { publisher: /^{{source}}$/i, license: WATERLOO_REGION_LICENSE }
    ],
    placeRules: [
        { publisher: /^city of kitchener$/i, placeId: 'sgc-csd-3530013', relationship: 'direct', includesDescendants: false },
        { publisher: /^city of cambridge$/i, placeId: 'sgc-csd-3530010', relationship: 'direct', includesDescendants: false },
        { publisher: /^city of waterloo$/i, placeId: 'sgc-csd-3530016', relationship: 'direct', includesDescendants: false },
        { publisher: /.*/, placeId: 'sgc-cd-3530', relationship: 'direct', includesDescendants: true }
    ]
}, {
    id: 'london-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of London Open Data',
    nameFr: 'Données ouvertes de la Ville de London',
    homepageUrl: 'https://open.london.ca/',
    catalogUrl: 'https://open.london.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open.london.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of london$/i, name: 'City of London' },
        { publisher: /^{{source}}$/i, name: 'City of London' }
    ],
    authoritativePublishers: [
        { publisher: /^city of london$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of london$/i, license: LONDON_LICENSE },
        { publisher: /^{{source}}$/i, license: LONDON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3539036',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'kelowna-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Kelowna Open Data',
    nameFr: 'Données ouvertes de la Ville de Kelowna',
    homepageUrl: 'https://opendata.kelowna.ca/',
    catalogUrl: 'https://opendata.kelowna.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.kelowna.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of kelowna$/i, name: 'City of Kelowna' },
        { publisher: /^{{source}}$/i, name: 'City of Kelowna' }
    ],
    authoritativePublishers: [
        { publisher: /^city of kelowna$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of kelowna$/i, license: KELOWNA_LICENSE },
        { publisher: /^{{source}}$/i, license: KELOWNA_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5935010',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'fredericton-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Fredericton Open Data',
    nameFr: 'Données ouvertes de la Ville de Fredericton',
    homepageUrl: 'https://data-fredericton.opendata.arcgis.com/',
    catalogUrl: 'https://data-fredericton.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-fredericton.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of fredericton$/i, name: 'City of Fredericton' },
        { publisher: /^{{source}}$/i, name: 'City of Fredericton' }
    ],
    authoritativePublishers: [
        { publisher: /^city of fredericton$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of fredericton$/i, license: FREDERICTON_LICENSE },
        { publisher: /^{{source}}$/i, license: FREDERICTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-1310032',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'burlington-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Burlington Open Data',
    nameFr: 'Données ouvertes de la Ville de Burlington',
    homepageUrl: 'https://navburl-burlington.opendata.arcgis.com/',
    catalogUrl: 'https://navburl-burlington.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'navburl-burlington.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of burlington$/i, name: 'City of Burlington' },
        { publisher: /^{{source}}$/i, name: 'City of Burlington' }
    ],
    authoritativePublishers: [
        { publisher: /^city of burlington$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of burlington$/i, license: BURLINGTON_LICENSE },
        { publisher: /^{{source}}$/i, license: BURLINGTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3524002',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'oakville-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Oakville Open Data',
    nameFr: 'Données ouvertes de la Ville d’Oakville',
    homepageUrl: 'https://oakville.opendata.arcgis.com/',
    catalogUrl: 'https://oakville.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'oakville.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^town of oakville$/i, name: 'Town of Oakville' },
        { publisher: /^{{source}}$/i, name: 'Town of Oakville' }
    ],
    authoritativePublishers: [
        { publisher: /^town of oakville$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^town of oakville$/i, license: OAKVILLE_LICENSE },
        { publisher: /^{{source}}$/i, license: OAKVILLE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3524001',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'milton-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Milton Open Data',
    nameFr: 'Données ouvertes de la Ville de Milton',
    homepageUrl: 'https://data-milton.opendata.arcgis.com/',
    catalogUrl: 'https://data-milton.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-milton.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^town of milton$/i, name: 'Town of Milton' },
        { publisher: /^{{source}}$/i, name: 'Town of Milton' }
    ],
    authoritativePublishers: [
        { publisher: /^town of milton$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^town of milton$/i, license: MILTON_LICENSE },
        { publisher: /^{{source}}$/i, license: MILTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3524009',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'sudbury-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Greater Sudbury Open Data',
    nameFr: 'Données ouvertes de la Ville du Grand Sudbury',
    homepageUrl: 'https://opendata.greatersudbury.ca/',
    catalogUrl: 'https://opendata.greatersudbury.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.greatersudbury.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of greater sudbury$/i, name: 'City of Greater Sudbury' },
        { publisher: /^{{source}}$/i, name: 'City of Greater Sudbury' }
    ],
    authoritativePublishers: [
        { publisher: /^city of greater sudbury$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of greater sudbury$/i, license: SUDBURY_LICENSE },
        { publisher: /^{{source}}$/i, license: SUDBURY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3553',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'burnaby-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Burnaby Open Data',
    nameFr: 'Données ouvertes de la Ville de Burnaby',
    homepageUrl: 'https://data.burnaby.ca/',
    catalogUrl: 'https://data.burnaby.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data.burnaby.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of burnaby$/i, name: 'City of Burnaby' },
        { publisher: /^{{source}}$/i, name: 'City of Burnaby' }
    ],
    authoritativePublishers: [
        { publisher: /^city of burnaby$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of burnaby$/i, license: BURNABY_LICENSE },
        { publisher: /^{{source}}$/i, license: BURNABY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5915025',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'saskatoon-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Saskatoon Open Data',
    nameFr: 'Données ouvertes de la Ville de Saskatoon',
    homepageUrl: 'https://open-data-saskatoon.hub.arcgis.com/',
    catalogUrl: 'https://open-data-saskatoon.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-data-saskatoon.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of saskatoon$/i, name: 'City of Saskatoon' },
        { publisher: /^{{source}}$/i, name: 'City of Saskatoon' }
    ],
    authoritativePublishers: [
        { publisher: /^city of saskatoon$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of saskatoon$/i, license: SASKATOON_LICENSE },
        { publisher: /^{{source}}$/i, license: SASKATOON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4711066',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'markham-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Markham Open Data',
    nameFr: 'Données ouvertes de la Ville de Markham',
    homepageUrl: 'https://data-markham.opendata.arcgis.com/',
    catalogUrl: 'https://data-markham.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-markham.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of markham$/i, name: 'City of Markham' },
        { publisher: /^{{source}}$/i, name: 'City of Markham' }
    ],
    authoritativePublishers: [
        { publisher: /^city of markham$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of markham$/i, license: MARKHAM_LICENSE },
        { publisher: /^{{source}}$/i, license: MARKHAM_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3519036',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'newmarket-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Newmarket Open Data',
    nameFr: 'Données ouvertes de la Ville de Newmarket',
    homepageUrl: 'https://data-newmarket.opendata.arcgis.com/',
    catalogUrl: 'https://data-newmarket.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-newmarket.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^town of newmarket$/i, name: 'Town of Newmarket' },
        { publisher: /^{{source}}$/i, name: 'Town of Newmarket' }
    ],
    authoritativePublishers: [
        { publisher: /^town of newmarket$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^town of newmarket$/i, license: NEWMARKET_LICENSE },
        { publisher: /^{{source}}$/i, license: NEWMARKET_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3519048',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'niagara-falls-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Niagara Falls Open Data',
    nameFr: 'Données ouvertes de la Ville de Niagara Falls',
    homepageUrl: 'https://open.niagarafalls.ca/',
    catalogUrl: 'https://open.niagarafalls.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open.niagarafalls.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of niagara falls$/i, name: 'City of Niagara Falls' },
        { publisher: /^{{source}}$/i, name: 'City of Niagara Falls' }
    ],
    authoritativePublishers: [
        { publisher: /^city of niagara falls$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of niagara falls$/i, license: NIAGARA_FALLS_LICENSE },
        { publisher: /^{{source}}$/i, license: NIAGARA_FALLS_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3526043',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'welland-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Welland Open Data',
    nameFr: 'Données ouvertes de la Ville de Welland',
    homepageUrl: 'https://open-welland.opendata.arcgis.com/',
    catalogUrl: 'https://open-welland.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-welland.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of welland$/i, name: 'City of Welland' },
        { publisher: /^{{source}}$/i, name: 'City of Welland' }
    ],
    authoritativePublishers: [
        { publisher: /^city of welland$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of welland$/i, license: WELLAND_LICENSE },
        { publisher: /^{{source}}$/i, license: WELLAND_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3526065',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'moncton-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Moncton Open Data',
    nameFr: 'Données ouvertes de la Ville de Moncton',
    homepageUrl: 'https://open.moncton.ca/',
    catalogUrl: 'https://open.moncton.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open.moncton.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of moncton$/i, name: 'City of Moncton' },
        { publisher: /^{{source}}$/i, name: 'City of Moncton' }
    ],
    authoritativePublishers: [
        { publisher: /^city of moncton$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of moncton$/i, license: MONCTON_LICENSE },
        { publisher: /^{{source}}$/i, license: MONCTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-1307022',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'guelph-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Guelph Open Data',
    nameFr: 'Données ouvertes de la Ville de Guelph',
    homepageUrl: 'https://open-guelph.opendata.arcgis.com/',
    catalogUrl: 'https://open-guelph.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-guelph.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of guelph$/i, name: 'City of Guelph' },
        { publisher: /^{{source}}$/i, name: 'City of Guelph' }
    ],
    authoritativePublishers: [
        { publisher: /^city of guelph$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of guelph$/i, license: GUELPH_LICENSE },
        { publisher: /^{{source}}$/i, license: GUELPH_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3523008',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'saanich-hub',
    kind: 'arcgis-hub',
    nameEn: 'District of Saanich Open Data',
    nameFr: 'Données ouvertes du district de Saanich',
    homepageUrl: 'https://data-saanich.opendata.arcgis.com/',
    catalogUrl: 'https://data-saanich.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-saanich.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^district of saanich$/i, name: 'District of Saanich' },
        { publisher: /^{{source}}$/i, name: 'District of Saanich' }
    ],
    authoritativePublishers: [
        { publisher: /^district of saanich$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^district of saanich$/i, license: SAANICH_LICENSE },
        { publisher: /^{{source}}$/i, license: SAANICH_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5917021',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'belleville-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Belleville Open Data',
    nameFr: 'Données ouvertes de la Ville de Belleville',
    homepageUrl: 'https://data-cityofbelleville.opendata.arcgis.com/',
    catalogUrl: 'https://data-cityofbelleville.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-cityofbelleville.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of belleville$/i, name: 'City of Belleville' },
        { publisher: /^{{source}}$/i, name: 'City of Belleville' }
    ],
    authoritativePublishers: [
        { publisher: /^city of belleville$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of belleville$/i, license: BELLEVILLE_LICENSE },
        { publisher: /^{{source}}$/i, license: BELLEVILLE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3512005',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'yellowknife-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Yellowknife Open Data',
    nameFr: 'Données ouvertes de la Ville de Yellowknife',
    homepageUrl: 'https://data-yellowknife.hub.arcgis.com/',
    catalogUrl: 'https://data-yellowknife.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-yellowknife.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of yellowknife$/i, name: 'City of Yellowknife' },
        { publisher: /^{{source}}$/i, name: 'City of Yellowknife' }
    ],
    authoritativePublishers: [
        { publisher: /^city of yellowknife$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of yellowknife$/i, license: YELLOWKNIFE_LICENSE },
        { publisher: /^{{source}}$/i, license: YELLOWKNIFE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-6106023',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'barrie-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Barrie Open Data',
    nameFr: 'Données ouvertes de la Ville de Barrie',
    homepageUrl: 'https://opendata.barrie.ca/',
    catalogUrl: 'https://opendata.barrie.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.barrie.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^the corporation of the city of barrie$/i, name: 'City of Barrie' },
        { publisher: /^city of barrie$/i, name: 'City of Barrie' },
        { publisher: /^{{source}}$/i, name: 'City of Barrie' }
    ],
    authoritativePublishers: [
        { publisher: /^the corporation of the city of barrie$/i },
        { publisher: /^city of barrie$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^the corporation of the city of barrie$/i, license: BARRIE_LICENSE },
        { publisher: /^city of barrie$/i, license: BARRIE_LICENSE },
        { publisher: /^{{source}}$/i, license: BARRIE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3543042',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'thunderbay-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Thunder Bay Open Data',
    nameFr: 'Données ouvertes de la Ville de Thunder Bay',
    homepageUrl: 'https://opendata-thunderbay.hub.arcgis.com/',
    catalogUrl: 'https://opendata-thunderbay.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata-thunderbay.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of thunder bay$/i, name: 'City of Thunder Bay' },
        { publisher: /^{{source}}$/i, name: 'City of Thunder Bay' }
    ],
    authoritativePublishers: [
        { publisher: /^city of thunder bay$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of thunder bay$/i, license: THUNDER_BAY_LICENSE },
        { publisher: /^{{source}}$/i, license: THUNDER_BAY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3558004',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'chatham-kent-hub',
    kind: 'arcgis-hub',
    nameEn: 'Municipality of Chatham-Kent Open Data',
    nameFr: 'Données ouvertes de la municipalité de Chatham-Kent',
    homepageUrl: 'https://opendata.chatham-kent.ca/',
    catalogUrl: 'https://opendata.chatham-kent.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.chatham-kent.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^municipality of chatham-kent$/i, name: 'Municipality of Chatham-Kent' },
        { publisher: /^chatham-kent$/i, name: 'Municipality of Chatham-Kent' },
        { publisher: /^{{source}}$/i, name: 'Municipality of Chatham-Kent' }
    ],
    authoritativePublishers: [
        { publisher: /^municipality of chatham-kent$/i },
        { publisher: /^chatham-kent$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^municipality of chatham-kent$/i, license: CHATHAM_KENT_LICENSE },
        { publisher: /^chatham-kent$/i, license: CHATHAM_KENT_LICENSE },
        { publisher: /^{{source}}$/i, license: CHATHAM_KENT_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3536',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'kawartha-lakes-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Kawartha Lakes Open Data',
    nameFr: 'Données ouvertes de la Ville de Kawartha Lakes',
    homepageUrl: 'https://open-data-kawartha.hub.arcgis.com/',
    catalogUrl: 'https://open-data-kawartha.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-data-kawartha.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of kawartha lakes$/i, name: 'City of Kawartha Lakes' },
        { publisher: /^kawartha lakes$/i, name: 'City of Kawartha Lakes' },
        { publisher: /^{{source}}$/i, name: 'City of Kawartha Lakes' }
    ],
    authoritativePublishers: [
        { publisher: /^city of kawartha lakes$/i },
        { publisher: /^kawartha lakes$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of kawartha lakes$/i, license: KAWARTHA_LAKES_LICENSE },
        { publisher: /^kawartha lakes$/i, license: KAWARTHA_LAKES_LICENSE },
        { publisher: /^{{source}}$/i, license: KAWARTHA_LAKES_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3516',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'summerland-hub',
    kind: 'arcgis-hub',
    nameEn: 'District of Summerland Open Data',
    nameFr: 'Données ouvertes du district de Summerland',
    homepageUrl: 'https://open-data-summerland.hub.arcgis.com/',
    catalogUrl: 'https://open-data-summerland.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open-data-summerland.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^the corporation of the district of summerland$/i, name: 'District of Summerland' },
        { publisher: /^district of summerland$/i, name: 'District of Summerland' },
        { publisher: /^summerland$/i, name: 'District of Summerland' },
        { publisher: /^{{source}}$/i, name: 'District of Summerland' }
    ],
    authoritativePublishers: [
        { publisher: /^the corporation of the district of summerland$/i },
        { publisher: /^district of summerland$/i },
        { publisher: /^summerland$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^the corporation of the district of summerland$/i, license: SUMMERLAND_LICENSE },
        { publisher: /^district of summerland$/i, license: SUMMERLAND_LICENSE },
        { publisher: /^summerland$/i, license: SUMMERLAND_LICENSE },
        { publisher: /^{{source}}$/i, license: SUMMERLAND_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5907035',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'norfolk-hub',
    kind: 'arcgis-hub',
    nameEn: 'Norfolk County Open Data',
    nameFr: 'Données ouvertes du comté de Norfolk',
    homepageUrl: 'https://data-norfolk.opendata.arcgis.com/',
    catalogUrl: 'https://data-norfolk.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-norfolk.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^the corporation of norfolk county$/i, name: 'Norfolk County' },
        { publisher: /^norfolk county$/i, name: 'Norfolk County' },
        { publisher: /^{{source}}$/i, name: 'Norfolk County' }
    ],
    authoritativePublishers: [
        { publisher: /^the corporation of norfolk county$/i },
        { publisher: /^norfolk county$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^the corporation of norfolk county$/i, license: NORFOLK_LICENSE },
        { publisher: /^norfolk county$/i, license: NORFOLK_LICENSE },
        { publisher: /^{{source}}$/i, license: NORFOLK_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3528052',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'haldimand-hub',
    kind: 'arcgis-hub',
    nameEn: 'Haldimand County Open Data',
    nameFr: 'Données ouvertes du comté de Haldimand',
    homepageUrl: 'https://opendata-haldimand.hub.arcgis.com/',
    catalogUrl: 'https://opendata-haldimand.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata-haldimand.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^the corporation of haldimand county$/i, name: 'Haldimand County' },
        { publisher: /^haldimand county$/i, name: 'Haldimand County' },
        { publisher: /^{{source}}$/i, name: 'Haldimand County' }
    ],
    authoritativePublishers: [
        { publisher: /^the corporation of haldimand county$/i },
        { publisher: /^haldimand county$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^the corporation of haldimand county$/i, license: HALDIMAND_LICENSE },
        { publisher: /^haldimand county$/i, license: HALDIMAND_LICENSE },
        { publisher: /^{{source}}$/i, license: HALDIMAND_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-3528018',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'lethbridge-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Lethbridge Open Data',
    nameFr: 'Données ouvertes de la Ville de Lethbridge',
    homepageUrl: 'https://opendata.lethbridge.ca/',
    catalogUrl: 'https://opendata.lethbridge.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.lethbridge.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of lethbridge$/i, name: 'City of Lethbridge' },
        { publisher: /^{{source}}$/i, name: 'City of Lethbridge' }
    ],
    authoritativePublishers: [
        { publisher: /^city of lethbridge$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of lethbridge$/i, license: LETHBRIDGE_LICENSE },
        { publisher: /^{{source}}$/i, license: LETHBRIDGE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4802012',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'medicine-hat-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Medicine Hat Open Data',
    nameFr: 'Données ouvertes de la Ville de Medicine Hat',
    homepageUrl: 'https://opendata.medicinehat.ca/',
    catalogUrl: 'https://opendata.medicinehat.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.medicinehat.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of medicine hat$/i, name: 'City of Medicine Hat' },
        { publisher: /^{{source}}$/i, name: 'City of Medicine Hat' }
    ],
    authoritativePublishers: [
        { publisher: /^city of medicine hat$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of medicine hat$/i, license: MEDICINE_HAT_LICENSE },
        { publisher: /^{{source}}$/i, license: MEDICINE_HAT_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4801006',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'airdrie-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Airdrie Open Data',
    nameFr: 'Données ouvertes de la Ville d’Airdrie',
    homepageUrl: 'https://data-airdrie.opendata.arcgis.com/',
    catalogUrl: 'https://data-airdrie.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-airdrie.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of airdrie$/i, name: 'City of Airdrie' },
        { publisher: /^{{source}}$/i, name: 'City of Airdrie' }
    ],
    authoritativePublishers: [
        { publisher: /^city of airdrie$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of airdrie$/i, license: AIRDRIE_LICENSE },
        { publisher: /^{{source}}$/i, license: AIRDRIE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4806021',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'canmore-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Canmore Open Data',
    nameFr: 'Données ouvertes de la Ville de Canmore',
    homepageUrl: 'https://opendata-canmore.opendata.arcgis.com/',
    catalogUrl: 'https://opendata-canmore.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata-canmore.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^town of canmore$/i, name: 'Town of Canmore' },
        { publisher: /^canmore$/i, name: 'Town of Canmore' },
        { publisher: /^{{source}}$/i, name: 'Town of Canmore' }
    ],
    authoritativePublishers: [
        { publisher: /^town of canmore$/i },
        { publisher: /^canmore$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^town of canmore$/i, license: CANMORE_LICENSE },
        { publisher: /^canmore$/i, license: CANMORE_LICENSE },
        { publisher: /^{{source}}$/i, license: CANMORE_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-4815023',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'penticton-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Penticton Open Data',
    nameFr: 'Données ouvertes de la Ville de Penticton',
    homepageUrl: 'https://open.penticton.ca/',
    catalogUrl: 'https://open.penticton.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'open.penticton.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of penticton$/i, name: 'City of Penticton' },
        { publisher: /^{{source}}$/i, name: 'City of Penticton' }
    ],
    authoritativePublishers: [
        { publisher: /^city of penticton$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of penticton$/i, license: PENTICTON_LICENSE },
        { publisher: /^{{source}}$/i, license: PENTICTON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5907041',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'langley-city-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Langley Open Data',
    nameFr: 'Données ouvertes de la Ville de Langley',
    homepageUrl: 'https://data-langleycity.opendata.arcgis.com/',
    catalogUrl: 'https://data-langleycity.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-langleycity.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^city of langley$/i, name: 'City of Langley' },
        { publisher: /^{{source}}$/i, name: 'City of Langley' }
    ],
    authoritativePublishers: [
        { publisher: /^city of langley$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^city of langley$/i, license: LANGLEY_CITY_LICENSE },
        { publisher: /^{{source}}$/i, license: LANGLEY_CITY_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-csd-5915001',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'huron-hub',
    kind: 'arcgis-hub',
    nameEn: 'County of Huron Open Data',
    nameFr: 'Données ouvertes du comté de Huron',
    homepageUrl: 'https://data-huron.opendata.arcgis.com/',
    catalogUrl: 'https://data-huron.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-huron.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    restrictedLicensePatterns: [/non.?commercial/i, /personal use only/i, /by-nc/i],
    publisherAliases: [
        { publisher: /^county of huron$/i, name: 'County of Huron' },
        { publisher: /^huron county$/i, name: 'County of Huron' },
        { publisher: /^{{source}}$/i, name: 'County of Huron' }
    ],
    authoritativePublishers: [
        { publisher: /^county of huron$/i },
        { publisher: /^huron county$/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /^county of huron$/i, license: HURON_LICENSE },
        { publisher: /^huron county$/i, license: HURON_LICENSE },
        { publisher: /^{{source}}$/i, license: HURON_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-3540',
        relationship: 'direct',
        includesDescendants: true
    }]
}, {
    id: 'cumberland-hub',
    kind: 'arcgis-hub',
    nameEn: 'Municipality of the County of Cumberland Open Data',
    nameFr: 'Données ouvertes de la municipalité du comté de Cumberland',
    homepageUrl: 'https://data-cumberlandns.opendata.arcgis.com/',
    catalogUrl: 'https://data-cumberlandns.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'data-cumberlandns.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    restrictedLicensePatterns: [/non.?commercial/i, /personal use only/i, /by-nc/i],
    publisherAliases: [
        { publisher: /^municipality of the county of cumberland$/i, name: 'Municipality of the County of Cumberland' },
        { publisher: /^cumberland county$/i, name: 'Municipality of the County of Cumberland' },
        { publisher: /^{{source}}$/i, name: 'Municipality of the County of Cumberland' }
    ],
    authoritativePublishers: [
        { publisher: /cumberland/i },
        { publisher: /^{{source}}$/i }
    ],
    licenseRules: [
        { publisher: /.*/, license: CUMBERLAND_LICENSE }
    ],
    placeRules: [{
        publisher: /.*/,
        placeId: 'sgc-cd-1211',
        relationship: 'direct',
        includesDescendants: true
    }]
}
];

function getSource(id) {
    return sources.find(source => source.id === id) || null;
}

module.exports = {
    sources,
    getSource,
    AJAX_LICENSE,
    PICKERING_LICENSE,
    WHITBY_LICENSE,
    CLOCA_LICENSE,
    ONTARIO_LICENSE,
    TORONTO_LICENSE,
    MONTREAL_LICENSE,
    QUEBEC_CITY_LICENSE,
    LAVAL_LICENSE,
    OTTAWA_LICENSE,
    OTTAWA_POLICE_LICENSE,
    VANCOUVER_LICENSE,
    CALGARY_LICENSE,
    EDMONTON_LICENSE,
    WINNIPEG_LICENSE,
    HALIFAX_LICENSE,
    HAMILTON_LICENSE,
    VICTORIA_LICENSE,
    WATERLOO_REGION_LICENSE,
    LONDON_LICENSE,
    KELOWNA_LICENSE,
    FREDERICTON_LICENSE,
    BURLINGTON_LICENSE,
    OAKVILLE_LICENSE,
    MILTON_LICENSE,
    SUDBURY_LICENSE,
    BURNABY_LICENSE,
    SASKATOON_LICENSE,
    YORK_REGION_LICENSE,
    MARKHAM_LICENSE,
    NEWMARKET_LICENSE,
    NIAGARA_FALLS_LICENSE,
    WELLAND_LICENSE,
    MONCTON_LICENSE,
    GUELPH_LICENSE,
    SAANICH_LICENSE,
    BELLEVILLE_LICENSE,
    YELLOWKNIFE_LICENSE,
    BARRIE_LICENSE,
    THUNDER_BAY_LICENSE,
    CHATHAM_KENT_LICENSE,
    KAWARTHA_LAKES_LICENSE,
    SUMMERLAND_LICENSE,
    NORFOLK_LICENSE,
    HALDIMAND_LICENSE,
    LETHBRIDGE_LICENSE,
    MEDICINE_HAT_LICENSE,
    AIRDRIE_LICENSE,
    CANMORE_LICENSE,
    PENTICTON_LICENSE,
    LANGLEY_CITY_LICENSE,
    HURON_LICENSE,
    CUMBERLAND_LICENSE,
    SURREY_LICENSE,
    MISSISSAUGA_LICENSE,
    CC_BY_4_LICENSE,
    OGL_CANADA_LICENSE,
    STATCAN_LICENSE,
    PEEL_LICENSE
};
