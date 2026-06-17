const { parsePeriodKey } = require('../utils/periodParse');
const { pickRepresentative, computeSnapshot } = require('../services/top100Compute');

describe('parsePeriodKey', () => {
    it('reads quarters, year-month and bare years; the most recent wins', () => {
        expect(parsePeriodKey('2025Q4-Employers')).toBeGreaterThan(parsePeriodKey('2024Q1-Employers'));
        expect(parsePeriodKey('Wages 2026-03')).toBeGreaterThan(parsePeriodKey('Wages 2026'));
        expect(parsePeriodKey('data 2019 to 2025')).toBe(parsePeriodKey('2025'));
    });
    it('returns null when there is no year, and ignores years inside longer numbers', () => {
        expect(parsePeriodKey('quarterly employers list')).toBeNull();
        expect(parsePeriodKey('salary 120000 threshold')).toBeNull();
    });
});

describe('pickRepresentative', () => {
    const cap = (fmt) => (fmt === 'CSV' || fmt === 'XLSX' || fmt === 'XLS' ? 50 * 1024 * 1024 : null);

    it('prefers the latest period among ingestable files, skipping non-files', () => {
        const rep = pickRepresentative([
            { id: 'a', format: 'CSV', name_en: '2020Q1 data', size_bytes: 100, last_modified: '2020-04-01' },
            { id: 'b', format: 'XLSX', name_en: '2025Q4 data', size_bytes: 100, last_modified: '2026-01-01' },
            { id: 'pdf', format: 'PDF', name_en: '2030 report', size_bytes: 100, last_modified: '2030-01-01' }
        ], cap);
        expect(rep.id).toBe('b');
    });

    it('returns null when no ingestable file exists', () => {
        expect(pickRepresentative([{ id: 'p', format: 'PDF', name_en: '2025', size_bytes: 1 }], cap)).toBeNull();
    });

    it('falls back to last_modified when names carry no period', () => {
        const rep = pickRepresentative([
            { id: 'old', format: 'CSV', name_en: 'employers', size_bytes: 100, last_modified: '2020-01-01' },
            { id: 'new', format: 'CSV', name_en: 'employers', size_bytes: 100, last_modified: '2026-01-01' }
        ], cap);
        expect(rep.id).toBe('new');
    });

    it('skips files over the size cap', () => {
        const rep = pickRepresentative([
            { id: 'big', format: 'CSV', name_en: '2025Q4', size_bytes: 999 * 1024 * 1024, last_modified: '2026-01-01' },
            { id: 'ok', format: 'CSV', name_en: '2024Q1', size_bytes: 100, last_modified: '2024-04-01' }
        ], cap);
        expect(rep.id).toBe('ok');
    });
});

describe('computeSnapshot', () => {
    const rows = [
        { id: 'd1', title: 'A', titre: 'A-fr', department: 'X', ministere: 'X-fr', downloads_telechargements: 10, month_mois: 4, year_annee: 2026 },
        { id: 'd1', title: 'A', titre: 'A-fr', department: 'X', ministere: 'X-fr', downloads_telechargements: 50, month_mois: 5, year_annee: 2026 },
        { id: 'd2', title: 'B', titre: 'B-fr', department: 'Y', ministere: 'Y-fr', downloads_telechargements: 99, month_mois: 5, year_annee: 2026 },
        { id: 'd2', title: 'B', titre: 'B-fr', department: 'Y', ministere: 'Y-fr', downloads_telechargements: 5, month_mois: 12, year_annee: 2025 }
    ];

    it('ranks only the latest snapshot by downloads and builds chronological history', () => {
        const snap = computeSnapshot(rows);
        expect(snap.year).toBe(2026);
        expect(snap.month).toBe(5);
        expect(snap.ranked.map(r => r.dataset_id)).toEqual(['d2', 'd1']); // 99 > 50, older months excluded
        expect(snap.ranked[0]).toMatchObject({ rank: 1, dataset_id: 'd2', downloads: 99, title_en: 'B', title_fr: 'B-fr' });
        expect(snap.historyByDataset.get('d1')).toEqual([{ y: 2026, m: 4, d: 10 }, { y: 2026, m: 5, d: 50 }]);
        expect(snap.historyByDataset.get('d2')).toEqual([{ y: 2025, m: 12, d: 5 }, { y: 2026, m: 5, d: 99 }]);
    });
});
