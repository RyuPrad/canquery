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

// "Total Atlantic", "Total Canada", "Total, all provinces": a total of a
// place or of everything is one in any table.
const TOTAL_OF_RE = /^(?:(?:grand|sub|sous)[ -]?)?(?:totals?|totaux)\s+(?:(?:for|of|de|des|du|pour)\s+)?(.+)$/i;

// "TOTALZONE 2", "SOUSTOTAL": a total written in capitals and run into its name.
const TOTAL_CAPS_RE = /^(?:SOUS-?|SUB-?|GRAND ?)?TOTAL(?=[A-Z0-9])/;

function isTotalLabel(label) {
    const text = trimLabel(label);
    if (TOTAL_RE.test(text) || TOTAL_CAPS_RE.test(text)) return true;
    const rest = TOTAL_OF_RE.exec(text);
    if (!rest) return false;
    const place = rest[1].replace(/^(?:the|la|le|les|l['’])\s*/i, '');
    return isProvinceName(place) || isRegionLabel(place) || isNationalLabel(place) || /^(?:all|tous|toutes|ensemble)\b/i.test(place) ||
        /^(?:the |les )?(?:provinces|territories|territoires)(?: (?:and|et) (?:territories|territoires))?$/i.test(place);
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
// Abbreviations as they are also written: "B.C.", "N.S.", "Que.", "Qu\u00e9", "Nfld.".
const PROVINCE_FORMS = new Set(['que', 'ont', 'alta', 'sask', 'man', 'nfld', 'nwt', 'tno', 'yk', 'yuk', 'p e i', 'ipe', 'tnl']);

function isProvinceName(label) {
    const text = plain(label);
    if (PROVINCES.has(text)) return true;
    const bare = text.replace(/\./g, '').replace(/\s+/g, ' ').trim();
    return PROVINCES.has(bare) || PROVINCE_FORMS.has(bare);
}

function isNationalLabel(label) {
    return NATIONAL_RE.test(plain(label));
}

// Groups of provinces that statistical tables list beside the provinces.
const REGION_RE = /^(?:atlantic|atlantique|atlantic canada|canada atlantique|l atlantique|atlantic provinces|provinces de l atlantique|provinces atlantiques|maritimes|maritime provinces|prairies|prairie provinces|provinces des prairies|territories|territoires|the territories|les territoires|western canada|eastern canada|central canada|northern canada|ouest canadien|est du canada|nord canadien|pacific|pacifique|the north|le nord)$/;

function isRegionLabel(label) {
    return REGION_RE.test(plain(label).replace(/['’]/g, ' '));
}

// --- What a category's labels say ----------------------------------------

// A code a reader cannot decode without a legend: "U", "3", "ESSF", "*GD",
// "J0K", "381A", "dnd-mdn", "T.Q.C". Short, without a space, and made of
// capitals, digits or symbols (or a short lower-case slug). Words, however
// short, are not codes when they are written as words ("West", "Rural").
// Spelled out, yes and no read; a lone "N" may be a code ("N": not applicable).
const YES_NO = new Set(['yes', 'no', 'oui', 'non']);
/**
 * How surely a label is a code: 2 surely ("U", "3", "*GD", "J0K", "dnd-mdn",
 * "ML", "MLSn"), 1 perhaps (four or five capitals: "ESSF" is a code, "RURAL"
 * a word; a column of many of them is codes), 0 not.
 */
function codeLevel(label, { sex = false } = {}) {
    const text = String(label ?? '').trim();
    if (!text || text.length > 8 || /\s/.test(text)) return 0;
    if (/^(?:1[89]|20)\d{2}$/.test(text)) return 0;
    const lower = text.toLowerCase();
    if (YES_NO.has(lower) || isProvinceName(text)) return 0;
    if (sex && /^(?:m|f|x|h)$/.test(lower)) return 0;
    if (/[0-9*#/_.\\|+]/.test(text)) return 2;
    if (/^[A-Z]{1,3}$/.test(text)) return 2;
    if (/^[a-z]{1,3}$/.test(text) || /^[a-z]{1,6}(?:-[a-z]{1,6})+$/.test(text)) return 2;
    if (/^[A-Z]{4,5}$/.test(text)) return 1;
    // Mixed case with two capitals or more and no lower-case vowel: "MLSn", "MLn".
    return /^[A-Za-z]{2,6}$/.test(text) && (text.match(/[A-Z]/g) || []).length >= 2 && !/[aeiouy]/.test(text.replace(/[A-Z]/g, '')) ? 2 : 0;
}

/** Are these labels, together, codes rather than words? */
function codeLabels(labels, options) {
    const named = labels.filter(label => String(label ?? '').trim() !== '');
    if (!named.length) return false;
    let sure = 0;
    let maybe = 0;
    for (const label of named) {
        const level = codeLevel(label, options);
        if (level === 2) sure += 1;
        else if (level === 1) maybe += 1;
    }
    // A few capitals ("URBAN", "RURAL") are words; many short ones are a code list.
    return sure / named.length >= 0.5 || (named.length >= 5 && (sure + maybe) / named.length >= 0.8);
}

// Which kind of breakdown a label belongs to, when that can be told: a place,
// a sex, or an age band. A column that lists several kinds lists the same
// people several times.
const SEX_LABEL_RE = /^(?:men|women|male|males|female|females|man|woman|boys|girls|hommes?|femmes?|garcons|filles|both sexes|les deux sexes|total[ ,-]+both sexes|sexes confondus|men\+|women\+|hommes\+|femmes\+)$/;
const AGE_LABEL_RE = /(?:^|\s)\d{1,3}\s*(?:to|-|–|à|a)\s*\d{1,3}(?:\s*(?:years?|yrs|ans))?(?:\s|$)|\d{1,3}\s*(?:years?|ans)\s*(?:and|et)\s*(?:over|older|plus)|^(?:under|less than|moins de)\s+\d{1,3}\s*(?:years?|ans)?|^\d{1,3}\s*\+$|^\d{1,3}\s*(?:years?|ans)\s*(?:\+|and over|et plus)$/;
function labelKind(label) {
    const text = plain(label).replace(/['’]/g, ' ');
    if (!text) return null;
    if (isProvinceName(text) || isNationalLabel(text) || isRegionLabel(text)) return 'place';
    if (SEX_LABEL_RE.test(text)) return 'sex';
    if (AGE_LABEL_RE.test(text)) return 'age';
    return null;
}

// A label that names a quantity, not a group: "Number of returns", "Total
// income", "Average wage", "Taux de chômage", "Revenue ($)". A column of them
// says what another column's numbers are, row by row.
const MEASURE_LABEL_RE = /^(?:number|numbers|nombre|nombres|nb|nbre|no\.?|#|count|counts|total|totals|amount|amounts|montant|montants|average|avg|mean|moyenne|median|mediane|rate|rates|taux|percent|percentage|pourcentage|proportion|ratio|share|part|index|indice|value|valeur|sum|somme|dollars|value of|valeur de)(?:\s|$|\s*\()/;
function isMeasureLabel(label) {
    const text = plain(label);
    if (!text || text.length > 120) return false;
    return MEASURE_LABEL_RE.test(text) || /\((?:\$|%|#|k\$|m\$|\$000|000\s*\$|dollars|number|nombre|nbre|per cent|pour cent)\)\s*$/.test(text);
}

// Text decoded with the wrong character set: "privÃ©e", "privŽe", "â€™".
const GARBLED_RE = /\u00C3[\u0080-\u00BF]|\u00C2[\u00A0-\u00BF]|\u00E2\u20AC|[a-z\u00E9][\u017D\u0192\u02C6\u2122\u0152\u0153][a-z]|\uFFFD/;
function isGarbled(label) {
    return GARBLED_RE.test(String(label ?? ''));
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
        'inscriptions', 'enrolment', 'enrollment', 'effectif', 'effectifs', 'hunters', 'chasseurs', 'days', 'jours',
        // Money by another name: "Crédit établi (dollars)", "Benefits paid".
        'dollars', 'dollar', 'credit', 'credits', 'benefits', 'prestations', 'refunds', 'remboursements', 'versements', 'allocations']),
    // Quantities that must never be added up.
    nonAdditive: words(['rate', 'rates', 'taux', 'ratio', 'ratios', 'percent', 'percentage', 'pourcentage', 'pct', 'proportion',
        'average', 'avg', 'moyenne', 'moyen', 'mean', 'median', 'mediane', 'index', 'indice', 'score', 'scores',
        'rank', 'rang', 'ranking', 'classement', 'rating', 'cote', 'price', 'prix', 'wage', 'wages', 'hourly', 'horaire',
        'per', 'par', 'density', 'densite', 'temperature', 'temp', 'age', 'elevation', 'altitude', 'depth', 'profondeur',
        'height', 'hauteur', 'speed', 'vitesse', 'limit', 'limite', 'limites', 'latitude', 'longitude', 'lat', 'lon', 'lng',
        'magnitude', 'ph', 'pressure', 'pression', 'grade', 'level', 'niveau', 'min', 'max', 'minimum', 'maximum',
        'minium', 'maximal', 'quartile', 'quartile1', 'quartile3', 'percentile', 'yield', 'rendement', 'growth',
        'croissance', 'change', 'variation', 'margin', 'marge', 'factor', 'facteur', 'coefficient', 'intensity',
        'intensite',
        // Limits, bounds and quantiles: "Nombre minimal d'administrateurs", "LL", "Upper CI".
        'minimal', 'minimale', 'minimaux', 'maximale', 'maximaux', 'mini', 'maxi', 'lower', 'upper', 'll', 'ul', 'lcl', 'ucl', 'ci',
        'confidence', 'bound', 'bounds', 'borne', 'bornes', 'decile', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95',
        // Sizes of one thing: a rink's width, a valve's diameter.
        'length', 'longueur', 'width', 'largeur', 'diameter', 'diametre', 'thickness', 'epaisseur', 'radius', 'rayon',
        // A moment, not an amount: the day or hour of a timestamp.
        'day', 'jour', 'hour', 'heure', 'minute', 'second', 'seconde', 'weekday', 'timestamp', 'datetime',
        // Rates of one thing: miles per gallon, kilometres per hour.
        'mpg', 'kph', 'mph']),
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
    // People's names: never something to group by ("John" is many people).
    personName: words(['first name', 'firstname', 'given name', 'given names', 'prenom', 'prenoms', 'last name', 'lastname', 'surname',
        'family name', 'nom de famille', 'middle name', 'second prenom']),
    // When the table's record was touched, not when anything happened.
    maintenance: words(['updated', 'update', 'last update', 'last updated', 'modified', 'last modified', 'modifie', 'modification',
        'mise a jour', 'maj', 'revision', 'revised', 'extracted', 'extraction', 'retrieved', 'refresh', 'refreshed', 'loaded',
        'load date', 'as of', 'en date du', 'processed', 'traitement', 'edited', 'edit date']),
    // Numbers that are themselves a breakdown: "Bedrooms 1, 2, 3", "Household size".
    countDimension: words(['bedroom', 'bedrooms', 'room', 'rooms', 'chambre', 'chambres', 'piece', 'pieces', 'storey', 'storeys',
        'stories', 'floor', 'floors', 'etage', 'etages', 'person', 'persons', 'personne', 'personnes', 'people', 'children', 'enfants',
        'members', 'membres', 'occupants', 'size', 'taille', 'age', 'ages', 'household', 'menage']),
    // A data dictionary: one row per column of some other table.
    dictionaryField: words(['field', 'field name', 'fieldname', 'champ', 'nom du champ', 'nom de champ', 'column name', 'colonne',
        'nom de colonne', 'variable', 'variable name', 'nom de variable', 'attribute', 'attribut', 'data element', 'element de donnees']),
    dictionaryDetail: words(['data type', 'datatype', 'type de donnees', 'field type', 'type de champ', 'format', 'domain', 'domaine',
        'definition', 'description', 'allowed values', 'valeurs permises', 'field length', 'longueur du champ']),
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
    // "n" heads a column of counts in statistical tables.
    const countName = COUNT_NAME_RE.test(normal + ' ') || normal === 'n';
    const percentName = /%/.test(String(name ?? ''));
    // A unit per something ("(g/km)", "(L/100 km)", "($/hour)") is a rate.
    const rateUnit = /[([][^()[\]]*\/[^()[\]]*[)\]]/.test(String(name ?? ''));
    const nonAdditive = has('nonAdditive') || percentName || rateUnit;
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
        personName: has('personName'),
        maintenance: has('maintenance'),
        countDimension: has('countDimension'),
        sex: /(?:^| )(?:sex|sexe|gender|genre)(?: |$)/.test(normal),
        dictionaryField: has('dictionaryField'),
        dictionaryDetail: has('dictionaryDetail'),
        english: has('english'),
        french: has('french')
    };
}

module.exports = {
    MISSING_TOKENS, BLANK_LABELS, TOTAL_RE, FOOTNOTE_RE, MARKED_NOTE_RE, NUMERIC_LABEL_RE, LABEL_LIMIT, CATEGORY_LABEL_LIMIT,
    isMissingToken, isBlankLabel, isTotalLabel, isFootnoteLabel, isMarkedNote, isGenericName, cleanLabel, normalizeName,
    nameEvidence, hasAggregateHint, isProvinceName, isNationalLabel, isRegionLabel, isAggregateLabel, TABLE_BLANK_TOKENS,
    codeLevel, codeLabels, labelKind, isMeasureLabel, isGarbled
};
