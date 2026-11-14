// Shared vocabulary for reading publisher tables: what stands in for "no
// value", what is a total or a footnote, which labels are too poor to chart,
// and the English and French name hints. Every chart surface reads these, so a
// table is cleaned the same way wherever it is drawn.
//
// Names are secondary evidence throughout the engine: they raise or lower
// confidence in what the values already show, and only decide where values
// cannot (a column of period labels, the language of a twin column).

// Cells of a number column that mean "no number here". Compared after
// trimming and lower-casing. Kept broad on purpose: inside a column that is
// otherwise numeric none of these can be a measurement. A text column never
// consults this list (see BLANK_LABELS).
const MISSING_TOKENS = new Set([
    '-', '--', '---', '—', '–', '.', '..', '...', '…', '*', '**', '***', '?',
    'n/a', 'na', 'n.a.', 'n.a', 'n/d', 'n.d.', 'nd', 'n/p', 'null', 'nil', 'none', 'nan', '#n/a', '#value!', '#div/0!',
    'x', 'f', 's.o.', 's.o', 'so', 's/o', 'nc', 'n.c.', 'n/c', 'nr', 'tbd', '(blank)', 'blank', 'missing',
    'not available', 'not applicable', 'non disponible', 'sans objet', 'non applicable', 'suppressed', 'supprimé',
    'no data', 'nodata', 'aucune donnée', 'aucune donnee', 'pas de données', 'pas de donnees', 'not reported', 'non déclaré',
    'unavailable', 'indisponible', 'n/r', 'n.d', 'n.r.'
]);

function isMissingToken(value) {
    return MISSING_TOKENS.has(String(value ?? '').trim().toLowerCase());
}

// Labels of a category column that mean "nothing recorded". Much narrower
// than the list above: in a text column "NA", "X", "SO" or "None" can be real
// categories, so only unmistakable placeholders fold into the blank group.
const BLANK_LABELS = new Set(['n/a', 'n.a.', 'n.a', '#n/a', 'null', 'nan', '(blank)', '(vide)', '(empty)', 'nil', 'n/d', 'n.d.', 's.o.', 's/o',
    'not available', 'non disponible', 'unavailable', 'indisponible', 'no data', 'aucune donnée', 'aucune donnee', 'sans objet', 'undefined']);
// Tokens that mean "nothing recorded" when a whole table uses them that way
// (the same token in several of its columns): "NA" from a statistics package
// is a blank, "NA" in one column of region codes is North America.
const TABLE_BLANK_TOKENS = new Set(['na', 'n.a', 'nd', 'nr', 'n/r', 'nc', 'n/c', 'missing', 'tbd', 'none', 'aucun', 'aucune']);
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function isBlankLabel(label, tableTokens) {
    const text = String(label ?? '').trim().toLowerCase();
    return text === '' || !HAS_LETTER_OR_DIGIT.test(text) || BLANK_LABELS.has(text) || Boolean(tableTokens && tableTokens.has(text));
}

// A member that adds the others up. Only exact forms: "Total capital" or
// "All-terrain vehicles" are real members, and a total under any other name
// ("Canada", "Both sexes", "All") is found from the numbers instead.
// "Total, all ages" and "Total - Age groups" are totals; "Total-factor
// productivity" is a member: a bare hyphen joins words.
const TOTAL_RE = /^(?:(?:(?:grand|sub|sous)[ -]?)?(?:totals?|totaux)(?: g[ée]n[ée]ral)?|totals?(?:\s*[,:–—]\s*|\s+-\s+)\S.*)$/i;
const TAIL_MARKS = new Set([':', '.', '*']);

// The label without spaces, colons, full stops and stars at its end. A loop:
// the equivalent regular expression takes quadratic time on long padding.
function trimLabel(label) {
    const text = String(label ?? '').trim();
    let end = text.length;
    while (end > 0 && (TAIL_MARKS.has(text[end - 1]) || /\s/.test(text[end - 1]))) end -= 1;
    return text.slice(0, end);
}

function isTotalLabel(label) {
    return TOTAL_RE.test(trimLabel(label));
}

// "Total expenditures", "Ontario Total", "Sous-total des revenus": in a table
// of figures a member named like this adds other members up. In a table of
// things or events it can be a real member ("Total loss"), so there the
// numbers must agree as well.
const AGGREGATE_RE = /^(?:(?:grand|sub|sous)[ -]?)?(?:totals?|totaux)\s+\S|\S\s+(?:totals?|totaux|totale|totales)$/i;

function isAggregateLabel(label) {
    return AGGREGATE_RE.test(trimLabel(label));
}

// Words that suggest a member adds others up ("Both sexes", "All ages",
// "Ensemble des provinces"). Never enough alone: the numbers must agree.
const AGGREGATE_HINT_RE = /(?:^|[^\p{L}])(?:totals?|totaux|sub-?totals?|sous-?totals?|all|both|tous|toutes|toute|tout|ensemble|combined|overall|global|national|nationale|canada|sum|somme|aggregate|les deux)(?:$|[^\p{L}])/iu;

function hasAggregateHint(label) {
    return AGGREGATE_HINT_RE.test(String(label ?? ''));
}

// Canada's provinces and territories, in both languages and as postal
// abbreviations, accents dropped. "Canada" among them is their total.
const PROVINCES = new Set(['alberta', 'british columbia', 'colombie-britannique', 'colombie britannique', 'manitoba', 'new brunswick',
    'nouveau-brunswick', 'nouveau brunswick', 'newfoundland and labrador', 'newfoundland', 'terre-neuve-et-labrador', 'terre-neuve',
    'nova scotia', 'nouvelle-ecosse', 'nouvelle ecosse', 'ontario', 'prince edward island', 'ile-du-prince-edouard',
    'ile du prince edouard', 'quebec', 'saskatchewan', 'northwest territories', 'territoires du nord-ouest', 'nunavut', 'yukon',
    'yukon territory', 'ab', 'bc', 'mb', 'nb', 'nl', 'ns', 'nt', 'nu', 'on', 'pe', 'pei', 'qc', 'sk', 'yt']);
const NATIONAL_RE = /^(?:canada|total canada|canada total|canada, total|ensemble du canada|national|nationale|all provinces|toutes les provinces)$/;
const plain = label => String(label ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function isProvinceName(label) {
    return PROVINCES.has(plain(label));
}

function isNationalLabel(label) {
    return NATIONAL_RE.test(plain(label));
}

// Groups of provinces that statistical tables list beside the provinces.
const REGION_RE = /^(?:atlantic|atlantique|atlantic provinces|provinces de l atlantique|provinces atlantiques|maritimes|maritime provinces|prairies|prairie provinces|provinces des prairies|territories|territoires|the territories|les territoires|western canada|eastern canada|central canada|northern canada|ouest canadien|est du canada|nord canadien|pacific|pacifique|the north|le nord)$/;

function isRegionLabel(label) {
    return REGION_RE.test(plain(label).replace(/['’]/g, ' '));
}

// Notes and sources that publishers keep inside their tables. These openings
// are never a category.
const FOOTNOTE_RE = new RegExp('^(?:' + [
    'for (?:further|more) information',
    'pour (?:plus|de plus amples) (?:de |d[’\'])?(?:informations?|renseignements)',
    '(?:notes?|sources?|footnotes?|nota|remarques?|commentaires?|copyright)\\s*[:：–—-]',
    'footnotes?\\b', 'notes? de bas de page',
    'see (?:note|table)', 'voir (?:la |les )?(?:note|tableau)', '©'
].join('|') + ')', 'i');

// A numbered or starred opening ("1. Data are preliminary", "* Estimate").
// Numbered categories exist too, so this needs support from the row itself
// (the rest of the row is empty, or the label stands alone) before it counts.
const MARKED_NOTE_RE = /^(?:\d{1,2}[.)]\s|[(]\d{1,2}[)]\s|[*†‡§¹²³]+\s*\S)/;

function isFootnoteLabel(label) {
    return FOOTNOTE_RE.test(String(label ?? '').trim());
}

function isMarkedNote(label) {
    return MARKED_NOTE_RE.test(String(label ?? '').trim());
}

const NUMERIC_LABEL_RE = /^[+-]?\d+(?:[.,]\d+)?$/;
const LABEL_LIMIT = 200;
// A category label longer than this is prose, not a category.
const CATEGORY_LABEL_LIMIT = 80;

// Control characters become spaces, runs of white space collapse.
function cleanLabel(value) {
    return String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Column names as words: camel case split, accents dropped, separators as
// spaces, lower case. "FiscalYear", "Année_fiscale" and "fiscal-year" then
// read alike.
function normalizeName(name) {
    return String(name ?? '')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[_\-./\\:;,()[\]{}|’']+/g, ' ')
        .replace(/\s+/g, ' ').trim().toLowerCase();
}

const words = list => new RegExp('(?:^| )(?:' + list.join('|') + ')(?: |$)');

// Each list is tested against normalizeName(), so entries are plain words.
const HINTS = {
    period: words(['year', 'years', 'yr', 'annee', 'annees', 'fiscal', 'exercice', 'period', 'periode', 'quarter', 'trimestre',
        'month', 'mois', 'fy', 'date']),
    yearPart: words(['month', 'mois', 'quarter', 'trimestre', 'qtr']),
    identifier: words(['id', 'ids', 'uuid', 'guid', 'key', 'ref', 'reference', 'hash', 'isbn',
        'objectid', 'fid', 'globalid', 'identifier', 'identifiant', 'numero', 'serial']),
    // A number given to a thing, not a quantity of things: "Ward 14", "Zone 3".
    nominal: words(['ward', 'wards', 'district', 'zone', 'sector', 'secteur', 'arrondissement', 'division', 'riding', 'circonscription',
        'poll', 'precinct', 'station', 'route', 'line', 'ligne', 'class', 'classe', 'grade', 'category', 'categorie', 'type', 'group',
        'groupe', 'section', 'block', 'bloc', 'lot', 'phase', 'floor', 'etage', 'site', 'plot', 'township', 'meridian', 'quartier',
        'region', 'branch', 'team', 'equipe', 'cluster', 'tier', 'priority', 'priorite', 'version', 'wave', 'cycle', 'round', 'stage',
        'etape', 'step', 'order', 'ordre', 'sort', 'tri', 'sequence']),
    rowNumber: words(['row', 'rang', 'ligne', 'objectid', 'fid', 'seq', 'sequence', 'no', 'num', 'numero', '#']),
    code: words(['code', 'codes', 'naics', 'scian', 'noc', 'cnp', 'sic', 'hs', 'cip', 'fsa', 'rta', 'zip', 'cd', 'uid']),
    // Quantities that add up.
    additive: words(['count', 'counts', 'nombre', 'nb', 'nbr', 'nbre', 'total', 'capital', 'assets', 'actifs', 'liabilities', 'passifs',
        'equity', 'debt', 'dette', 'loans', 'prets', 'deposits', 'depots', 'income', 'salary', 'salaries', 'salaire', 'salaires', 'totals', 'totaux', 'amount', 'amounts', 'montant', 'montants',
        'sum', 'somme', 'quantity', 'quantite', 'qty', 'volume', 'population', 'positions', 'postes', 'employees', 'employes',
        'units', 'unites', 'revenue', 'revenues', 'revenu', 'revenus', 'recettes', 'sales', 'ventes', 'expenses', 'depenses',
        'expenditure', 'expenditures', 'budget', 'cost', 'costs', 'cout', 'couts', 'payment', 'payments', 'paiement', 'paiements',
        'funding', 'financement', 'grant', 'grants', 'subvention', 'subventions', 'contribution', 'contributions',
        'hours', 'heures', 'tonnes', 'tons', 'cases', 'cas', 'permits', 'permis', 'deaths', 'deces', 'births', 'naissances',
        'visits', 'visites', 'trips', 'voyages', 'passengers', 'passagers', 'arrivals', 'arrivees', 'admissions', 'claims',
        'demandes', 'applications', 'approvals', 'approved', 'approuves', 'issued', 'delivres', 'kills', 'harvest', 'recolte',
        'captures', 'landings', 'debarquements', 'production', 'exports', 'exportations', 'imports', 'importations',
        'emissions', 'hectares', 'acres', 'gifts', 'dons', 'donations', 'lmias', 'eimt', 'incidents', 'accidents',
        'collisions', 'injuries', 'blesses', 'fatalities', 'tickets', 'licences', 'licenses', 'registrations',
        'inscriptions', 'enrolment', 'enrollment', 'effectif', 'effectifs', 'hunters', 'chasseurs', 'days', 'jours']),
    // Quantities that must never be added up.
    nonAdditive: words(['rate', 'rates', 'taux', 'ratio', 'ratios', 'percent', 'percentage', 'pourcentage', 'pct', 'proportion',
        'average', 'avg', 'moyenne', 'moyen', 'mean', 'median', 'mediane', 'index', 'indice', 'score', 'scores',
        'rank', 'rang', 'ranking', 'classement', 'rating', 'cote', 'price', 'prix', 'wage', 'wages', 'hourly', 'horaire',
        'per', 'par', 'density', 'densite', 'temperature', 'temp', 'age', 'elevation', 'altitude', 'depth', 'profondeur',
        'height', 'hauteur', 'speed', 'vitesse', 'limit', 'limite', 'limites', 'latitude', 'longitude', 'lat', 'lon', 'lng',
        'magnitude', 'ph', 'pressure', 'pression', 'grade', 'level', 'niveau', 'min', 'max', 'minimum', 'maximum',
        'minium', 'maximal', 'quartile', 'quartile1', 'quartile3', 'percentile', 'yield', 'rendement', 'growth',
        'croissance', 'change', 'variation', 'margin', 'marge', 'factor', 'facteur', 'coefficient', 'intensity',
        'intensite']),
    // A column whose values say what another column's numbers are.
    measureName: words(['measure', 'measures', 'mesure', 'mesures', 'indicator', 'indicators', 'indicateur', 'indicateurs',
        'variable', 'variables', 'metric', 'metrics', 'statistic', 'statistics', 'statistique', 'statistiques',
        'characteristic', 'characteristics', 'caracteristique', 'caracteristiques', 'data point']),
    // Names that often head a column of measure names and as often an
    // ordinary category ("Account" of a ledger): the values must agree.
    measureNameWeak: words(['item', 'items', 'element', 'elements', 'series', 'serie', 'estimate', 'estimates', 'estimation', 'account',
        'compte', 'line item', 'label', 'libelle', 'concept', 'component', 'composante']),
    unit: words(['unit', 'units', 'unite', 'unites', 'uom', 'unit of measure', 'unite de mesure', 'currency', 'currencies',
        'devise', 'devises', 'scalar', 'scalar factor']),
    geometry: words(['objectid', 'fid', 'globalid', 'shape area', 'shape length', 'shape leng', 'st area', 'st length',
        'x coord', 'y coord', 'easting', 'northing', 'geom', 'geometry', 'the geom', 'wkt']),
    latitude: words(['lat', 'latitude']),
    longitude: words(['lon', 'lng', 'longitude']),
    freeText: words(['description', 'descriptions', 'desc', 'note', 'notes', 'comment', 'comments', 'commentaire', 'commentaires',
        'remarks', 'remarques', 'summary', 'resume', 'details', 'abstract', 'text', 'texte']),
    label: words(['name', 'names', 'nom', 'noms', 'title', 'titre', 'address', 'adresse', 'street', 'rue', 'email', 'courriel',
        'url', 'website', 'site web', 'phone', 'telephone', 'tel', 'employer', 'employeur', 'organization', 'organisme']),
    total: words(['total', 'totals', 'totaux', 'tot', 'somme', 'sum', 'ytd', 'cumul', 'cumulatif', 'ensemble', 'all']),
    english: words(['en', 'eng', 'english', 'anglais', 'ang', 'e']),
    french: words(['fr', 'fra', 'fre', 'french', 'francais', 'f'])
};

// "Number of permits", "No. of employees", "Nbre de cas", "# of visits": a
// count, whatever the first word looks like on its own.
const COUNT_NAME_RE = /(?:^| )(?:number|numbers|no|nb|nbr|nbre|nombre|nombres|num|count|counts|#) (?:of|de|d|des|du) /;
// Projected coordinates under any prefix: "loc_x", "POINT_Y", "UTM Easting", "coord x".
const COORDINATE_NAME_RE = /(?:^|[a-z] )(?:x|y|easting|northing)$|(?:^| )(?:utm|mtm|nad83|nad27|wgs84|coord|coords|coordonnee|coordonnees)(?: |$)|(?:^| )(?:disp|pos|coord|loc|point|pt|cent|centroid|utm|geo|map)(?:x|y)$/;
// Words for a number given to a thing that are too short or too common to
// trust anywhere in a name: they count at its end ("Permit No"), or at its
// start before one more word ("no_demande"), unless that word makes an
// English "no ..." phrase ("No certificate").
const WEAK_ID_END_RE = /[a-z0-9] (?:no|num|number|nbr|sin|nas|bn|ne|pin)$/;
const WEAK_ID_START_RE = /^(?:no|num|numero) (?!high|highschool|school|schooling|certificate|diploma|degree|income|response|answer|change|children|religion|knowledge|data|value|fixed|usual)[a-z]+$/;
// "locationid", "assetid": an id written as one word. Words that merely end in "id" are not.
const ID_SUFFIX_RE = /(?:^| )(?!(?:paid|unpaid|prepaid|valid|invalid|liquid|bid|grid|covid|hybrid|fluid|solid|rapid|kid|mid|void|avoid|android|humid|acid|said|aid|raid|arid|rigid|vivid|lipid|orchid|pyramid|madrid)$)[a-z]{3,}id$/;
// A unit of measure written into the name: "COT (µg/L)", "Height (cm)", "Débit [m3/s]".
// Linear: the part before the slash cannot contain a bracket or a slash.
const UNIT_IN_NAME_RE = /[([](?:[^()[\]/]*\/[^()[\]]*|µg|ug|mg|kg|g|t|l|ml|cm|mm|km|m|m2|m3|ha|°c|ppm|ppb|ntu|kwh|mwh|gwh|kw|mw|gj|pj|kt|mt|\$|k\$|m\$|%)[)\]]/i;
// Coordinates by a name that is nothing else: "Long", "X", "Y coord".
const LONGITUDE_ONLY_RE = /^(?:long|x|x coord|coord x)$/;
const LATITUDE_ONLY_RE = /^(?:y|y coord|coord y)$/;
// "Riders by route", "Cases per ward": a quantity broken down, not a number given to a thing.
const BREAKDOWN_RE = /(?:^| )(?:by|per|par|pour)(?: |$)/;
// Names are read once each: the same headers come back for every pair of columns.
const NAME_LIMIT = 200;
const evidence = new Map();
// A name that says nothing about its column ("column_3", "value", "Unnamed").
const GENERIC_NAME_RE = /^(?:column|col|field|champ|unnamed|untitled|unknown|inconnu|data|donnees|value|values|valeur|valeurs|number|nombre|metric|measure|mesure|x|y|v)?(?: ?\d+)?$/;

function isGenericName(name) {
    const normal = normalizeName(name);
    return !/[a-z]{3}/.test(normal) || GENERIC_NAME_RE.test(normal);
}

// What a column's name suggests, with the two precedence rules that names
// need: a count phrase is never an identifier, and a name that reads both
// additive and not (an "average amount") is not additive.
function nameEvidence(name) {
    const text = String(name ?? '').slice(0, NAME_LIMIT);
    const known = evidence.get(text);
    if (known) return known;
    if (evidence.size >= 5000) evidence.clear();
    const found = readName(text);
    evidence.set(text, found);
    return found;
}

function readName(name) {
    const normal = normalizeName(name);
    const has = kind => HINTS[kind].test(normal);
    const countName = COUNT_NAME_RE.test(normal + ' ');
    const percentName = /%/.test(String(name ?? ''));
    const nonAdditive = has('nonAdditive') || percentName;
    const lastWord = normal.split(' ').pop();
    return {
        normal,
        generic: isGenericName(name),
        period: has('period'),
        yearPart: has('yearPart'),
        identifier: !countName && (has('identifier') || WEAK_ID_END_RE.test(normal) || WEAK_ID_START_RE.test(normal) || ID_SUFFIX_RE.test(lastWord)),
        nominal: !countName && has('nominal') && !BREAKDOWN_RE.test(normal),
        unitInName: UNIT_IN_NAME_RE.test(String(name ?? '')),
        rowNumber: !countName && (has('rowNumber') || /^(?:#|index|idx)$/.test(normal)),
        code: has('code'),
        // "count_id" is the id of a count, not a count.
        additive: !nonAdditive && !/^(?:id|ids|uuid|guid|key|objectid|fid|globalid|identifier|identifiant)$/.test(lastWord) && (countName || has('additive')),
        nonAdditive,
        measureName: has('measureName'),
        measureNameWeak: has('measureNameWeak'),
        unit: has('unit'),
        geometry: has('geometry') || COORDINATE_NAME_RE.test(normal),
        latitude: has('latitude') || LATITUDE_ONLY_RE.test(normal),
        longitude: has('longitude') || LONGITUDE_ONLY_RE.test(normal),
        freeText: has('freeText'),
        label: has('label'),
        total: has('total'),
        english: has('english'),
        french: has('french')
    };
}

module.exports = {
    MISSING_TOKENS, BLANK_LABELS, TOTAL_RE, FOOTNOTE_RE, MARKED_NOTE_RE, NUMERIC_LABEL_RE, LABEL_LIMIT, CATEGORY_LABEL_LIMIT,
    isMissingToken, isBlankLabel, isTotalLabel, isFootnoteLabel, isMarkedNote, isGenericName, cleanLabel, normalizeName,
    nameEvidence, hasAggregateHint, isProvinceName, isNationalLabel, isRegionLabel, isAggregateLabel, TABLE_BLANK_TOKENS
};
