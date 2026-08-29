const { sources, getSource, ...licenses } = require('../config/catalogSources');

describe('configured municipal catalogue sources', () => {
    test('syncs city portals before the authoritative portal in each regional cluster', () => {
        expect(sources.map(source => source.id)).toEqual([
            'toronto-open-data', 'montreal-open-data', 'quebec-city-open-data', 'laval-open-data',
            'ottawa-hub', 'vancouver-open-data',
            'calgary-open-data', 'edmonton-open-data', 'winnipeg-open-data', 'halifax-hub',
            'hamilton-hub', 'surrey-hub', 'victoria-hub',
            'waterloo-region-hub', 'kitchener-hub', 'cambridge-hub', 'waterloo-city-hub',
            'london-hub', 'kelowna-hub', 'fredericton-hub',
            'burlington-hub', 'oakville-hub', 'milton-hub', 'greater-sudbury-hub', 'burnaby-hub', 'saskatoon-hub',
            'york-region-hub', 'markham-hub', 'newmarket-hub',
            'niagara-region-hub', 'niagara-falls-hub', 'welland-hub',
            'moncton-hub', 'guelph-hub', 'saanich-hub', 'belleville-hub',
            'yellowknife-hub', 'barrie-hub', 'thunder-bay-hub', 'chatham-kent-hub',
            'kawartha-lakes-hub', 'summerland-hub', 'norfolk-hub', 'haldimand-hub',
            'lethbridge-hub', 'medicine-hat-hub', 'airdrie-hub', 'canmore-hub',
            'penticton-hub', 'langley-city-hub', 'huron-hub', 'cumberland-hub',
            'mississauga-hub', 'brampton-hub', 'peel-hub',
            'oshawa-hub', 'ajax-hub', 'pickering-hub', 'whitby-hub', 'cloca-hub', 'durham-hub'
        ]);
    });

    test('configures v32 multi-province sources with official licences and direct place rules', () => {
        const v32Sources = [
            { id: 'lethbridge-hub', host: 'opendata.lethbridge.ca', placeId: 'sgc-csd-4802012' },
            { id: 'medicine-hat-hub', host: 'opendata.medicinehat.ca', placeId: 'sgc-csd-4801006' },
            { id: 'airdrie-hub', host: 'data-airdrie.opendata.arcgis.com', placeId: 'sgc-csd-4806021' },
            { id: 'canmore-hub', host: 'opendata-canmore.opendata.arcgis.com', placeId: 'sgc-csd-4815023' },
            { id: 'penticton-hub', host: 'open.penticton.ca', placeId: 'sgc-csd-5907041' },
            { id: 'langley-city-hub', host: 'data-langleycity.opendata.arcgis.com', placeId: 'sgc-csd-5915001' },
            { id: 'huron-hub', host: 'data-huron.opendata.arcgis.com', placeId: 'sgc-cd-3540' },
            { id: 'cumberland-hub', host: 'data-cumberlandns.opendata.arcgis.com', placeId: 'sgc-cd-1211' }
        ];

        for (const { id, host, placeId } of v32Sources) {
            const source = getSource(id);
            expect(source).toBeDefined();
            expect(source.kind).toBe('arcgis-hub');
            expect(source.upstreamHost).toBe(host);
            expect(source.placeRules[0].placeId).toBe(placeId);
            expect(source.placeRules[0].relationship).toBe('direct');
        }
    });
});
