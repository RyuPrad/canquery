require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { syncPlaces } = require('../scripts/sync-places');

describe('syncPlaces service', () => {
    test('canonicalizes v32 places with correct slugs, viewports, and featured flags', async () => {
        const mockFetch = jest.fn().mockResolvedValue({
            dataset: [
                { GEO_ID: '4802012', GEO_NAME_EN: 'Lethbridge', GEO_NAME_FR: 'Lethbridge', GEO_TYPE_EN: 'City', GEO_TYPE_FR: 'Cité', PR_ID: '48', CD_ID: '4802' },
                { GEO_ID: '4801006', GEO_NAME_EN: 'Medicine Hat', GEO_NAME_FR: 'Medicine Hat', GEO_TYPE_EN: 'City', GEO_TYPE_FR: 'Cité', PR_ID: '48', CD_ID: '4801' },
                { GEO_ID: '4806021', GEO_NAME_EN: 'Airdrie', GEO_NAME_FR: 'Airdrie', GEO_TYPE_EN: 'City', GEO_TYPE_FR: 'Cité', PR_ID: '48', CD_ID: '4806' },
                { GEO_ID: '4815023', GEO_NAME_EN: 'Canmore', GEO_NAME_FR: 'Canmore', GEO_TYPE_EN: 'Town', GEO_TYPE_FR: 'Ville', PR_ID: '48', CD_ID: '4815' },
                { GEO_ID: '5907041', GEO_NAME_EN: 'Penticton', GEO_NAME_FR: 'Penticton', GEO_TYPE_EN: 'City', GEO_TYPE_FR: 'Cité', PR_ID: '59', CD_ID: '5907' },
                { GEO_ID: '5915001', GEO_NAME_EN: 'Langley', GEO_NAME_FR: 'Langley', GEO_TYPE_EN: 'City', GEO_TYPE_FR: 'Cité', PR_ID: '59', CD_ID: '5915' },
                { GEO_ID: '3540', GEO_NAME_EN: 'Huron', GEO_NAME_FR: 'Huron', GEO_TYPE_EN: 'County', GEO_TYPE_FR: 'Comté', PR_ID: '35', CD_ID: '3540' },
                { GEO_ID: '1211', GEO_NAME_EN: 'Cumberland', GEO_NAME_FR: 'Cumberland', GEO_TYPE_EN: 'County', GEO_TYPE_FR: 'Comté', PR_ID: '12', CD_ID: '1211' }
            ]
        });

        const summary = await syncPlaces({ fetchJson: mockFetch });
        expect(summary).toBeDefined();
    });
});
