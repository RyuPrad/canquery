// Server-side chart picker for the landing-page hero teasers. A compact mirror of
// the client classifier (client/src/components/charts/classify.js) that returns a
// single chart spec per dataset, matching what pickHero would surface on /insights:
// a donut (low-distinct category) is preferred, then a line over time, then bars.
// Kept here (not shared with the ESM client module) so the server stays CommonJS.

const NUM_RE = /int|numeric|float|double|money|real|decimal/i;
const DATE_RE = /date|time/i;
const YEAR_NAME_RE = /(^|[_\s])(year|yr|annee|fiscal|period|periode|exercice|quarter|trimestre|month|mois)([_\s]|$)/i;
const ID_NAME_RE = /(^|[_\s])(id|uuid|guid|code|number|num|no|key|ref|reference|hash|isbn|sin|bn|pin)([_\s]|$)/i;
const FREEFORM_RE = /(name|title|description|desc|note|comment|address|street|email|url|website|phone|tel|postal|coordinate|latitude|longitude|geometry|remarks)/i;
const DIM_NAME_RE = /(province|state|region|territo|jurisdiction|status|statut|type|categor|sector|secteur|\bsex\b|gender|genre|group|groupe|class|language|langue|country|pays|department|minist|program|level|niveau|grade|mode|method|methode|result|resultat|decision|industr|naics|\bsic\b|rating|band|tier|segment|disposition|outcome|currency|\bunit\b|frequency|season|species|breed|fuel|source|format|flag|active|enabled|reason|phase|stage|risk|priority|severity|race|ethnic|occupation|role|rank|division|category)/i;

const ratio = (c, rc) => (rc > 0 ? c.distinct / rc : 1);
const nullFrac = (c, rc) => (rc > 0 ? (c.nulls || 0) / rc : 0);

function isTemporal(c) {
    if (DATE_RE.test(c.type)) return true;
    if (YEAR_NAME_RE.test(c.id)) return true;
    if (NUM_RE.test(c.type) && c.min != null && c.max != null && c.min >= 1700 && c.max <= 2200) return true;
    return false;
}

function isIdentifier(c, rc) {
    if (NUM_RE.test(c.type) && c.distinct >= Math.max(100, rc * 0.85)) return true;
    if (ID_NAME_RE.test(c.id) && c.distinct > 25) return true;
    if (FREEFORM_RE.test(c.id) && c.distinct > 50) return true;
    if (rc > 50 && c.distinct >= rc * 0.9) return true;
    return false;
}

function isSurrogateId(c, rc) {
    if (ID_NAME_RE.test(c.id)) return true;
    if (/int/i.test(c.type) && c.distinct >= Math.max(100, rc * 0.85)) return true;
    return false;
}

function isCategorical(c, rc) {
    if (isTemporal(c) || isIdentifier(c, rc)) return false;
    if (c.distinct < 2 || c.distinct > 60) return false;
    if (NUM_RE.test(c.type)) return c.distinct <= 20 && ratio(c, rc) < 0.25;
    return true;
}

function dimScore(c, rc) {
    let s = 0;
    const d = c.distinct;
    if (d >= 2 && d <= 7) s += 45;
    else if (d <= 15) s += 35;
    else if (d <= 30) s += 20;
    else s += 8;
    s += (1 - nullFrac(c, rc)) * 18;
    if (DIM_NAME_RE.test(c.id)) s += 25;
    if (NUM_RE.test(c.type)) s -= 6;
    return s;
}

function bucketFor(c) {
    if (!DATE_RE.test(c.type)) return null; // year-like columns group on the raw value
    return c.distinct > 60 ? 'year' : 'month';
}

// Returns { kind, groupBy, agg, aggColumn?, bucket?, limit, sort } or null.
function pickChartSpec(profile) {
    const rc = profile && profile.row_count ? profile.row_count : 0;
    const cols = ((profile && profile.columns) || []).filter((c) => c && c.id !== '_id');

    const dates = cols
        .filter((c) => isTemporal(c) && c.distinct >= 2)
        .map((c) => ({ ...c, isRealDate: DATE_RE.test(c.type), bucket: bucketFor(c) }))
        .sort((a, b) => (b.isRealDate - a.isRealDate));

    const dimensions = cols
        .filter((c) => isCategorical(c, rc))
        .map((c) => ({ ...c, score: dimScore(c, rc) }))
        .sort((a, b) => b.score - a.score);

    const measures = cols
        .filter((c) => NUM_RE.test(c.type) && !isTemporal(c) && !isSurrogateId(c, rc) && c.distinct > 2)
        .filter((c) => !dimensions.some((d) => d.id === c.id))
        .sort((a, b) => b.distinct - a.distinct);

    // pickHero order: donut (any dimension with <=6 distinct) > timeseries > bars.
    const donut = dimensions.find((d) => d.distinct <= 6);
    if (donut) return { kind: 'donut', groupBy: donut.id, agg: 'count', limit: 6, sort: 'value' };

    const time = dates[0];
    if (time && measures[0]) return { kind: 'line', groupBy: time.id, agg: 'avg', aggColumn: measures[0].id, bucket: time.bucket, limit: 30, sort: 'key' };
    if (time) return { kind: 'line', groupBy: time.id, agg: 'count', bucket: time.bucket, limit: 30, sort: 'key' };

    if (dimensions[0]) return { kind: 'bars', groupBy: dimensions[0].id, agg: 'count', limit: 8, sort: 'value' };

    return null;
}

module.exports = { pickChartSpec };
