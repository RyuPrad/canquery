const { parsePeriodKey } = require('../utils/periodParse');

// Pure helpers behind scripts/seed-top100.js, kept DB-free (the cap function is
// injected) so they unit-test in isolation.

// From the full analytics table (one row per dataset per monthly snapshot) find
// the most recent (year, month), rank that snapshot by downloads, and assemble
// each dataset's download history for the row sparklines.
function computeSnapshot(rows) {
    let maxY = -Infinity;
    let maxM = -Infinity;
    for (const r of rows) {
        const y = Number(r.year_annee);
        const m = Number(r.month_mois);
        if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
        if (y > maxY || (y === maxY && m > maxM)) { maxY = y; maxM = m; }
    }

    const historyByDataset = new Map();
    for (const r of rows) {
        if (!r.id) continue;
        if (!historyByDataset.has(r.id)) historyByDataset.set(r.id, []);
        historyByDataset.get(r.id).push({
            y: Number(r.year_annee),
            m: Number(r.month_mois),
            d: Number(r.downloads_telechargements) || 0
        });
    }
    for (const arr of historyByDataset.values()) arr.sort((a, b) => a.y - b.y || a.m - b.m);

    const latest = rows.filter(r => Number(r.year_annee) === maxY && Number(r.month_mois) === maxM);
    latest.sort((a, b) => (Number(b.downloads_telechargements) || 0) - (Number(a.downloads_telechargements) || 0));
    const ranked = latest.map((r, i) => ({
        rank: i + 1,
        dataset_id: r.id,
        title_en: r.title,
        title_fr: r.titre,
        department: r.department,
        ministere: r.ministere,
        downloads: Number(r.downloads_telechargements) || 0
    }));

    return {
        year: Number.isFinite(maxY) ? maxY : null,
        month: Number.isFinite(maxM) ? maxM : null,
        ranked,
        historyByDataset
    };
}

// Among a dataset's resources, pick the one to ingest + chart: an ingestable file
// (CSV/XLSX/XLS under cap, per the injected capBytesFor) of the latest period,
// tie-broken by most recently modified, then largest. null => download-only.
function pickRepresentative(resources, capBytesFor) {
    const ingestable = (resources || []).filter(r => {
        const cap = capBytesFor(r.format);
        return cap !== null && (r.size_bytes == null || Number(r.size_bytes) <= cap);
    });
    if (ingestable.length === 0) return null;
    ingestable.sort((a, b) => {
        const pa = parsePeriodKey(a.name_en || a.name_fr || '');
        const pb = parsePeriodKey(b.name_en || b.name_fr || '');
        if (pa !== pb) return (pb === null ? -1 : pb) - (pa === null ? -1 : pa);
        const la = a.last_modified ? new Date(a.last_modified).getTime() : 0;
        const lb = b.last_modified ? new Date(b.last_modified).getTime() : 0;
        if (la !== lb) return lb - la;
        return (Number(b.size_bytes) || 0) - (Number(a.size_bytes) || 0);
    });
    return ingestable[0];
}

module.exports = { computeSnapshot, pickRepresentative };
