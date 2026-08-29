const {
    sources,
    getSource,
    OSHAWA_LICENSE,
    DURHAM_LICENSE,
    AJAX_LICENSE,
    PICKERING_LICENSE,
    WHITBY_LICENSE,
    CLOCA_LICENSE,
    ONTARIO_LICENSE,
    TORONTO_LICENSE,
    OTTAWA_LICENSE,
    OTTAWA_POLICE_LICENSE,
    VANCOUVER_LICENSE,
    CALGARY_LICENSE,
    EDMONTON_LICENSE,
    WINNIPEG_LICENSE,
    HALIFAX_LICENSE,
    HAMILTON_LICENSE,
    SURREY_LICENSE,
    VICTORIA_LICENSE,
    WATERLOO_REGION_LICENSE,
    KITCHENER_LICENSE,
    CAMBRIDGE_LICENSE,
    WATERLOO_CITY_LICENSE,
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
    MISSISSAUGA_LICENSE,
    CC_BY_4_LICENSE,
    OGL_CANADA_LICENSE,
    STATCAN_LICENSE,
    PEEL_LICENSE
} = require('../config/catalogSources');

describe('catalogSources configuration', () => {
    test('defines all required municipal sources and license helpers', () => {
        expect(Array.isArray(sources)).toBe(true);
        expect(sources.length).toBeGreaterThanOrEqual(32);
        expect(typeof getSource).toBe('function');
        expect(OSHAWA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(DURHAM_LICENSE.url).toMatch(/^https?:\/\//);
        expect(AJAX_LICENSE.url).toMatch(/^https?:\/\//);
        expect(PICKERING_LICENSE.url).toMatch(/^https?:\/\//);
        expect(WHITBY_LICENSE.url).toMatch(/^https?:\/\//);
        expect(CLOCA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(ONTARIO_LICENSE.url).toMatch(/^https?:\/\//);
        expect(TORONTO_LICENSE.url).toMatch(/^https?:\/\//);
        expect(OTTAWA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(OTTAWA_POLICE_LICENSE.url).toMatch(/^https?:\/\//);
        expect(VANCOUVER_LICENSE.url).toMatch(/^https?:\/\//);
        expect(CALGARY_LICENSE.url).toMatch(/^https?:\/\//);
        expect(EDMONTON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(WINNIPEG_LICENSE.url).toMatch(/^https?:\/\//);
        expect(HALIFAX_LICENSE.url).toMatch(/^https?:\/\//);
        expect(HAMILTON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(SURREY_LICENSE.url).toMatch(/^https?:\/\//);
        expect(VICTORIA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(WATERLOO_REGION_LICENSE.url).toMatch(/^https?:\/\//);
        expect(KITCHENER_LICENSE.url).toMatch(/^https?:\/\//);
        expect(CAMBRIDGE_LICENSE.url).toMatch(/^https?:\/\//);
        expect(WATERLOO_CITY_LICENSE.url).toMatch(/^https?:\/\//);
        expect(LONDON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(KELOWNA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(FREDERICTON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(BURLINGTON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(OAKVILLE_LICENSE.url).toMatch(/^https?:\/\//);
        expect(MILTON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(SUDBURY_LICENSE.url).toMatch(/^https?:\/\//);
        expect(BURNABY_LICENSE.url).toMatch(/^https?:\/\//);
        expect(SASKATOON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(YORK_REGION_LICENSE.url).toMatch(/^https?:\/\//);
        expect(MARKHAM_LICENSE.url).toMatch(/^https?:\/\//);
        expect(NEWMARKET_LICENSE.url).toMatch(/^https?:\/\//);
        expect(NIAGARA_FALLS_LICENSE.url).toMatch(/^https?:\/\//);
        expect(WELLAND_LICENSE.url).toMatch(/^https?:\/\//);
        expect(MONCTON_LICENSE.url).toMatch(/^https?:\/\//);
        expect(GUELPH_LICENSE.url).toMatch(/^https?:\/\//);
        expect(SAANICH_LICENSE.url).toMatch(/^https?:\/\//);
        expect(BELLEVILLE_LICENSE.url).toMatch(/^https?:\/\//);
        expect(MISSISSAUGA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(CC_BY_4_LICENSE.url).toMatch(/^https?:\/\//);
        expect(OGL_CANADA_LICENSE.url).toMatch(/^https?:\/\//);
        expect(STATCAN_LICENSE.url).toMatch(/^https?:\/\//);
        expect(PEEL_LICENSE.url).toMatch(/^https?:\/\//);
    });

    test('configures York Region, Niagara, Moncton, Guelph, Saanich, and Belleville sources', () => {
        const markham = getSource('markham-hub');
        const newmarket = getSource('newmarket-hub');
        const niagaraFalls = getSource('niagara-falls-hub');
        const welland = getSource('welland-hub');
        const moncton = getSource('moncton-hub');
        const guelph = getSource('guelph-hub');
        const saanich = getSource('saanich-hub');
        const belleville = getSource('belleville-hub');

        expect(markham).toBeDefined();
        expect(markham.kind).toBe('arcgis-hub');
        expect(newmarket).toBeDefined();
        expect(newmarket.kind).toBe('arcgis-hub');
        expect(niagaraFalls).toBeDefined();
        expect(niagaraFalls.kind).toBe('arcgis-hub');
        expect(welland).toBeDefined();
        expect(welland.kind).toBe('arcgis-hub');
        expect(moncton).toBeDefined();
        expect(moncton.kind).toBe('arcgis-hub');
        expect(guelph).toBeDefined();
        expect(guelph.kind).toBe('arcgis-hub');
        expect(saanich).toBeDefined();
        expect(saanich.kind).toBe('arcgis-hub');
        expect(belleville).toBeDefined();
        expect(belleville.kind).toBe('arcgis-hub');
    });
});
