// The brain of the auto-dashboard. Given a column profile (distinct/null counts
// + numeric/date ranges) it decides which columns are worth charting and what to
// chart - so a noob never has to know that grouping 643k rows by a unique
// "Corporation number" yields 643k bars of height 1.

const NUM_RE = /int|numeric|float|double|money|real|decimal/i;
const DATE_RE = /date|time/i;

// Names that signal an identifier or free-text field - never a good breakdown.
const ID_NAME_RE = /(^|[_\s])(id|uuid|guid|code|number|num|no|key|ref|reference|hash|isbn|sin|bn|pin)([_\s]|$)/i;
const FREEFORM_RE = /(name|title|description|desc|note|comment|address|street|email|url|website|phone|tel|postal|coordinate|latitude|longitude|geometry|remarks)/i;
// Columns that act as a time axis even when they aren't a real DATE type.
const YEAR_NAME_RE = /(^|[_\s])(year|yr|annee|fiscal|period|periode|exercice|quarter|trimestre|month|mois)([_\s]|$)/i;

// Names that read as a quantity to sum/average rather than an identifier.
const MEASURE_NAME_RE = /(amount|total|value|cost|price|sum|revenue|expense|expenditure|budget|salary|wage|\bpay\b|fee|funding|grant|payment|score|\brate\b|ratio|percent|quantity|\bqty\b|weight|volume|\barea\b|length|distance|population|\bgdp\b|income|balance|spend|\btax\b|duration|temperature|departure|\bindex\b|average|mean|median|count)/i;

// Names that strongly suggest a meaningful categorical dimension (EN + FR).
const DIM_NAME_RE =/(province|state|region|territo|jurisdiction|status|statut|type|categor|sector|secteur|\bsex\b|gender|genre|group|groupe|class|language|langue|country|pays|department|minist|program|level|niveau|grade|mode|method|methode|result|resultat|decision|industr|naics|\bsic\b|rating|band|tier|segment|disposition|outcome|currency|\bunit\b|frequency|season|species|breed|fuel|source|format|flag|active|enabled|reason|phase|stage|risk|priority|severity|race|ethnic|occupation|role|rank|division|category)/i;

const frac = (c, rowCount) => (rowCount > 0 ? (c.nulls || 0) / rowCount : 0);
const ratio = (c, rowCount) => (rowCount > 0 ? c.distinct / rowCount : 1);

function isTemporal(c) {
  if (DATE_RE.test(c.type)) return true;
  if (YEAR_NAME_RE.test(c.id)) return true;
  // Bare numbers that all sit in a plausible year range read as a time axis.
  if (NUM_RE.test(c.type) && c.min != null && c.max != null && c.min >= 1700 && c.max <= 2200) return true;
  return false;
}

// Is this column really just a row identifier or free text in disguise?
function isIdentifier(c, rowCount) {
  if (NUM_RE.test(c.type) && c.distinct >= Math.max(100, rowCount * 0.85)) return true;
  if (ID_NAME_RE.test(c.id) && c.distinct > 25) return true;
  if (FREEFORM_RE.test(c.id) && c.distinct > 50) return true;
  if (rowCount > 50 && c.distinct >= rowCount * 0.9) return true;
  return false;
}

// A stricter "id" test for measures: an explicitly id-named column, or a unique
// *integer* surrogate key. A unique-valued decimal (money, a rate) is a real
// measure, not an identifier - so it must NOT be excluded here.
function isSurrogateId(c, rowCount) {
  if (ID_NAME_RE.test(c.id)) return true;
  if (/int/i.test(c.type) && c.distinct >= Math.max(100, rowCount * 0.85) && !MEASURE_NAME_RE.test(c.id)) return true;
  return false;
}

// A categorical column makes a good breakdown: textual + low-ish cardinality, or
// a numeric with very few distinct values (a rating/flag), but never a
// continuous numeric measure.
function isCategorical(c, rowCount) {
  if (isTemporal(c) || isIdentifier(c, rowCount)) return false;
  if (c.distinct < 2 || c.distinct > 60) return false;
  if (NUM_RE.test(c.type)) return c.distinct <= 20 && ratio(c, rowCount) < 0.25;
  return true;
}

function dimScore(c, rowCount) {
  let s = 0;
  const d = c.distinct;
  if (d >= 2 && d <= 7) s += 45;        // perfect for a donut
  else if (d <= 15) s += 35;            // great for a bar
  else if (d <= 30) s += 20;
  else s += 8;
  s += (1 - frac(c, rowCount)) * 18;    // reward well-populated columns
  if (DIM_NAME_RE.test(c.id)) s += 25;  // recognizable dimension name
  if (NUM_RE.test(c.type)) s -= 6;      // prefer textual categoricals
  return s;
}

function bucketFor(c) {
  if (!DATE_RE.test(c.type)) return null; // year-like columns group on raw value
  if (c.min && c.max) {
    const a = new Date(c.min);
    const b = new Date(c.max);
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
      const days = Math.abs(b - a) / 86400000;
      if (days > 1095) return 'year';
      if (days > 75) return 'month';
      return 'day';
    }
  }
  return c.distinct > 60 ? 'year' : 'month';
}

export function classifyColumns(profile) {
  const rowCount = profile?.row_count || 0;
  const cols = (profile?.columns || []).filter((c) => c && c.id !== '_id');

  const dates = cols
    .filter((c) => isTemporal(c) && c.distinct >= 2)
    .map((c) => ({ ...c, isRealDate: DATE_RE.test(c.type), bucket: bucketFor(c), nullFrac: frac(c, rowCount) }))
    // real dates first, then most-populated
    .sort((a, b) => (b.isRealDate - a.isRealDate) || (a.nullFrac - b.nullFrac));

  const dimensions = cols
    .filter((c) => isCategorical(c, rowCount))
    .map((c) => ({ ...c, score: dimScore(c, rowCount) }))
    .sort((a, b) => b.score - a.score);

  const measures = cols
    .filter((c) => NUM_RE.test(c.type) && !isTemporal(c) && !isSurrogateId(c, rowCount) && c.distinct > 2)
    .filter((c) => !dimensions.some((d) => d.id === c.id))
    .map((c) => ({ ...c, nullFrac: frac(c, rowCount) }))
    .sort((a, b) => a.nullFrac - b.nullFrac || b.distinct - a.distinct);

  return { rowCount, columns: cols, dimensions, dates, measures };
}

const breakdown = (dim) => ({
  kind: dim.distinct <= 6 ? 'donut' : 'bar',
  role: 'breakdown',
  column: dim.id,
  agg: 'count',
});

// Plan up to six self-contained charts that, together, tell the dataset's story.
export function buildInsights({ dimensions, dates, measures }) {
  const insights = [];
  const time = dates[0];
  const [d0, d1, d2] = dimensions;
  const measure0 = measures[0];

  if (time && measures.length) {
    // A metrics-over-time table (e.g. yearly climate readings): one line per
    // measure, averaged across each period.
    for (const m of measures.slice(0, 4)) {
      insights.push({
        kind: 'timeseries', role: 'metric_time', column: time.id, agg: 'avg', aggColumn: m.id,
        bucket: time.bucket, categorical: !time.isRealDate,
      });
    }
  } else if (time) {
    // An event table (e.g. incorporations): how many records per period.
    insights.push({
      kind: 'timeseries', role: 'time', column: time.id, agg: 'count',
      bucket: time.bucket, categorical: !time.isRealDate,
    });
  }

  if (d0) insights.push(breakdown(d0));
  if (d1) insights.push(breakdown(d1));
  if (measure0 && d0) insights.push({ kind: 'bar', role: 'measure', column: d0.id, agg: 'sum', aggColumn: measure0.id });
  if (d2) insights.push(breakdown(d2));

  return insights
    .slice(0, 6)
    .map((s, i) => ({ ...s, colorOffset: i, key: [s.role, s.column, s.aggColumn || s.agg, i].join('|') }));
}

// A short row of headline numbers above the charts.
export function buildKpis({ rowCount, dimensions, dates, measures }) {
  const kpis = [{ role: 'rows', value: rowCount, format: 'int' }];
  const dt = dates[0];
  if (dt && dt.isRealDate && dt.min && dt.max) kpis.push({ role: 'span', column: dt.id, min: dt.min, max: dt.max });
  const d0 = dimensions[0];
  if (d0) kpis.push({ role: 'distinct', column: d0.id, value: d0.distinct });
  for (const m of measures) {
    if (kpis.length >= 4) break;
    if (m.avg != null) kpis.push({ role: 'avg', column: m.id, value: m.avg });
  }
  if (kpis.length < 3 && dimensions[1]) kpis.push({ role: 'distinct', column: dimensions[1].id, value: dimensions[1].distinct });
  return kpis.slice(0, 4);
}

export const hasAnyInsight = (c) => c.dimensions.length > 0 || c.dates.length > 0 || c.measures.length > 0;
