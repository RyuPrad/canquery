const fs = require('node:fs');
const path = require('node:path');
const { FEDERAL_PUBLISHER_PLACES, federalPublisherPlace } = require('../config/federalPublisherPlaces');

const migrations = path.join(__dirname, '..', 'sql', 'migrations');

describe('federal publisher places', () => {
    test('match the backfill migrations, entry for entry', () => {
        const backfilled = {};
        for (const file of fs.readdirSync(migrations).filter(name => /_federal_provincial_places\.sql$/.test(name)).sort()) {
            const sql = fs.readFileSync(path.join(migrations, file), 'utf8');
            for (const [, name, placeId] of sql.matchAll(/\('([a-z-]+)',\s*'([a-z0-9-]+)'\)/g)) backfilled[name] = placeId;
        }
        expect(backfilled).toEqual({ ...FEDERAL_PUBLISHER_PLACES });
        expect(Object.keys(backfilled)).toHaveLength(12);
    });

    test('name places the migrations seed, so community databases have them', () => {
        const seeded = fs.readdirSync(migrations).filter(name => name.endsWith('.sql') && !/_federal_provincial_places\.sql$/.test(name))
            .map(name => fs.readFileSync(path.join(migrations, name), 'utf8')).join('\n');
        for (const placeId of new Set(Object.values(FEDERAL_PUBLISHER_PLACES))) expect(seeded).toContain("'" + placeId + "'");
    });

    test('looks up only the listed organization names', () => {
        expect(federalPublisherPlace('yk')).toBe('sgc-pr-60');
        for (const name of ['YK', 'toString', '', null, undefined, 42]) expect(federalPublisherPlace(name)).toBeNull();
        expect(Object.isFrozen(FEDERAL_PUBLISHER_PLACES)).toBe(true);
    });
});
