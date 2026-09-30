// Pick one bounded, interpretable preview from a prepared resource. The result
// still needs aggregate-level quality checks before it can become a chart.

const NUM_RE = /int|numeric|float|double|money|real|decimal/i;
const DATE_RE = /date|time/i;
const YEAR_NAME_RE = /(^|[_\s])(year|yr|annee|fiscal|period|periode|exercice|quarter|trimestre|month|mois)([_\s]|$)/i;
const ID_NAME_RE = /(^|[_\s])(id|uuid|guid|code|number|num|no|key|ref|reference|hash|isbn|sin|bn|pin)([_\s]|$)/i;
const FREEFORM_RE = /(name|title|description|desc|note|comment|address|street|email|url|website|phone|tel|postal|coordinate|latitude|longitude|geometry|remarks)/i;
const MEASURE_NAME_RE = /(amount|total|value|cost|price|revenue|expense|expenditure|budget|salary|wage|\bpay\b|fee|funding|grant|payment|score|\brate\b|ratio|percent|quantity|\bqty\b|weight|volume|\barea\b|length|distance|population|income|balance|spend|\btax\b|duration|temperature|departure|\bindex\b|average|mean|median|count|montant|cout|prix|revenu|depense|salaire|valeur|taux|pourcentage|quantite|duree)/i;
const UNIT_NAME_RE = /(^|[_\s])(unit|units|unite|unites|currency|currencies|devise|devises)([_\s]|$)/i;
const VAGUE_NAME_RE = /^(?:column|col|field|champ|unnamed|unknown|inconnu|data|donnees|value|values|valeur|valeurs|number|nombre|metric|measure|mesure)(?:[_\s-]*\d+)?$/i;
const DIM_NAME_RE = /(province|state|region|territo|jurisdiction|status|statut|type|categor|sector|secteur|\bsex\b|gender|genre|group|groupe|class|language|langue|country|pays|department|minist|program|level|niveau|grade|mode|method|methode|result|resultat|decision|industr|naics|\bsic\b|rating|band|tier|segment|disposition|outcome|currency|\bunit\b|frequency|season|species|breed|fuel|source|format|flag|active|enabled|reason|phase|stage|risk|priority|severity|race|ethnic|occupation|role|rank|division|category)/i;

const ratio = (c, rc) => (rc > 0 ? c.distinct / rc : 1);
const nullFrac = (c, rc) => (rc > 0 ? (c.nulls || 0) / rc : 0);
const normalizedName = c => String(c.id || '').replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ');
const namedContext = c => /[a-z]{3}/i.test(normalizedName(c)) && !VAGUE_NAME_RE.test(normalizedName(c));

function isTemporal(c) {
    if (!namedContext(c)) return false;
    if (DATE_RE.test(c.type)) return true;
    if (YEAR_NAME_RE.test(normalizedName(c))) return true;
    return false;
}

function isIdentifier(c, rc) {
    const populated = rc - (c.nulls || 0);
    if (populated > 0 && c.distinct >= populated * 0.9) return true;
    if (NUM_RE.test(c.type) && c.distinct >= Math.max(100, rc * 0.85)) return true;
    if (ID_NAME_RE.test(normalizedName(c))) return true;
    if (FREEFORM_RE.test(normalizedName(c)) && c.distinct > 50) return true;
    return false;
}

function isSurrogateId(c, rc) {
    if (ID_NAME_RE.test(normalizedName(c))) return true;
    if (/int/i.test(c.type) && c.distinct >= Math.max(100, rc * 0.85) && !MEASURE_NAME_RE.test(normalizedName(c))) return true;
    return false;
}

function isCategorical(c, rc) {
    if (!namedContext(c)) return false;
    if (isTemporal(c) || isIdentifier(c, rc)) return false;
    if (c.distinct < 2 || c.distinct > 60) return false;
    if (NUM_RE.test(c.type) && MEASURE_NAME_RE.test(normalizedName(c))) return false;
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
function pickChartSpec(profile, recordedColumns = profile?.columns || []) {
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
        .filter((c) => namedContext(c) && MEASURE_NAME_RE.test(normalizedName(c)))
        .filter((c) => !dimensions.some((d) => d.id === c.id))
        .sort((a, b) => b.distinct - a.distinct);

    // Profiling is bounded to 60 columns. A recorded unit field outside that
    // profile has unknown variation, so an automatic average would be unsafe.
    const mixedUnits = cols.some(c => UNIT_NAME_RE.test(normalizedName(c)) && c.distinct > 1) ||
        recordedColumns.some(c => UNIT_NAME_RE.test(normalizedName(c)) && !cols.some(profiled => profiled.id === c.id));
    const time = dates[0];
    if (time && measures[0] && !mixedUnits) return { kind: 'line', groupBy: time.id, agg: 'avg', aggColumn: measures[0].id, bucket: time.bucket, limit: 30, sort: 'key_desc' };
    if (time) return { kind: 'line', groupBy: time.id, agg: 'count', bucket: time.bucket, limit: 30, sort: 'key_desc' };

    // Include one possible NULL group alongside the six non-NULL categories.
    // The output builder uses a donut only when the entire group set fits.
    const donut = dimensions.find((d) => d.distinct <= 6);
    if (donut) return { kind: 'donut', groupBy: donut.id, agg: 'count', limit: 7, sort: 'value' };

    if (dimensions[0]) return { kind: 'bars', groupBy: dimensions[0].id, agg: 'count', limit: 5, sort: 'value' };

    return null;
}

module.exports = { pickChartSpec };
