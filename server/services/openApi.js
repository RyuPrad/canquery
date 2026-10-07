const { CREDIT_COSTS, WORKFLOW_COSTS } = require('./commercialConfig');
const { operationFor, isPublicOperation } = require('./commercialOperations');
// Documentation only. Keep these shapes aligned with the public controllers;
// this module neither queries data nor exposes private runtime configuration.
const ref = name => ({ $ref: '#/components/schemas/' + name });
const array = items => ({ type: 'array', items });
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const string = { type: 'string' };
const textOrNull = { type: ['string', 'null'] };
const integer = { type: 'integer', minimum: 0 };
const numberOrNull = { type: ['number', 'null'] };
const date = { type: ['string', 'null'], format: 'date-time' };
const scalar = { type: ['string', 'number', 'boolean', 'null'] };
const kinds = ['country', 'province', 'territory', 'region', 'municipality'];
const failureReasons = ['invalid_file', 'upstream_unavailable', 'capacity', 'temporary', null];
const envelope = data => object({ data, pagination: ref('Pagination'), meta: ref('Meta') }, ['data', 'pagination', 'meta']);
const sample = (data, meta = {}, nextCursor = null) => ({ data, pagination: { nextCursor }, meta: { source: 'canquery', license: null, upstream: null, ...meta } });

const schemas = {
    Pagination: object({ nextCursor: { type: ['string', 'null'], description: 'Next catalogue offset as a string, or null. Row queries use data.total and offset instead.', 'x-description-fr': 'Décalage suivant du catalogue sous forme de chaîne, ou null. Les requêtes de lignes utilisent plutôt data.total et offset.' } }, ['nextCursor']),
    LocalizedText: object({ en: textOrNull, fr: textOrNull }),
    Field: object({ id: string, type: string }, ['id', 'type']),
    License: object({ title: ref('LocalizedText'), url: string, attribution: ref('LocalizedText') }),
    Provenance: object({ sources: array(ref('ProvenanceSource')), primary_license: nullable(ref('License')) }, ['sources', 'primary_license']),
    ProvenanceSource: object({ id: string, kind: string, name: ref('LocalizedText'), homepage_url: string,
        landing_url: textOrNull, upstream: string, authoritative: { type: 'boolean' }, license: nullable(ref('License')) }),
    Meta: object({ source: string, license: textOrNull, upstream: textOrNull, sources: array(string), provenance: ref('Provenance'),
        query_mode: { type: 'string', enum: ['datastore', 'ingested'] }, aggregation: ref('Aggregation'), map: ref('ViewportMetadata'),
        search: object({ query: string, suggestions: array(string) }),
        period: nullable(object({ year: integer, month: { type: 'integer', minimum: 1, maximum: 12 } })) }, ['source', 'license', 'upstream']),
    Error: object({ error: string, request_id: { ...string, description: 'Match X-Request-Id when contacting support. Some CORS/rate-limit responses omit this field.', 'x-description-fr': 'Correspond à X-Request-Id pour le soutien. Certaines réponses CORS ou de limite de fréquence omettent ce champ.' },
        code: { ...string, description: 'Examples: INVALID_API_KEY, API_KEY_REQUIRED, KEY_DISABLED, ACCOUNT_SUSPENDED, QUOTA_EXCEEDED, RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY, PREPARATION_COOLDOWN, ACCOUNTING_UNAVAILABLE.', 'x-description-fr': 'Exemples : INVALID_API_KEY, API_KEY_REQUIRED, KEY_DISABLED, ACCOUNT_SUSPENDED, QUOTA_EXCEEDED, RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY, PREPARATION_COOLDOWN, ACCOUNTING_UNAVAILABLE.' },
        retry_after: { type: 'integer', minimum: 1 }, hint: string, download_url: string }, ['error']),
    PlaceIdentity: object({ id: string, slug: string, kind: { type: 'string', enum: kinds }, name: ref('LocalizedText'),
        relationship: { type: 'string', enum: ['direct', 'coverage'] }, includes_descendants: { type: 'boolean' } }),
    Location: object({ latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, zoom: { type: ['integer', 'null'], minimum: 0, maximum: 22 } }),
    Organization: object({ id: string, name: string, title: ref('LocalizedText'), dataset_count: integer, queryable_dataset_count: integer,
        mappable_dataset_count: integer, metadata_modified: date, place: nullable(ref('PlaceIdentity')) }),
    Place: object({ id: string, slug: string, kind: { type: 'string', enum: kinds }, name: ref('LocalizedText'), type: ref('LocalizedText'),
        featured: { type: 'boolean' }, parent: nullable(ref('PlaceIdentity')), parent_id: textOrNull, location: nullable(ref('Location')),
        ancestors: array(ref('PlaceIdentity')), children: array(ref('Place')), dataset_count: integer, direct_dataset_count: integer,
        mappable_resource_count: integer, mappable_dataset_count: integer }),
    Source: object({ id: string, kind: string, name: ref('LocalizedText'), homepage_url: string, catalog_url: textOrNull, upstream: string,
        dataset_count: integer, authoritative_dataset_count: integer, last_synced_at: date }),
    Presentation: object({ title: ref('LocalizedText'), summary: ref('LocalizedText'), description: ref('LocalizedText'), context: ref('LocalizedText'),
        formats: array(string), languages: array(string), capabilities: { type: 'object' },
        fields: object({ items: array(object({ name: string, type: textOrNull })), total: integer, source: { type: ['string', 'null'], enum: ['table', 'map', null] } }) }),
    DatasetSummary: object({ id: string, name: string, title: ref('LocalizedText'), description: ref('LocalizedText'),
        preview_resources: object({ map: textOrNull, table: textOrNull }), organization: nullable(ref('Organization')), metadata_modified: date,
        resource_count: integer, queryable_count: integer, mappable_count: integer, places: array(ref('PlaceIdentity')),
        place_match: nullable(object({ tier: { type: 'string', enum: ['exact', 'parent'] }, depth: integer, relationship: string, place: ref('PlaceIdentity') })),
        provenance: ref('Provenance') }, ['id', 'name', 'title', 'provenance']),
    Dataset: object({ id: string, name: string, title: ref('LocalizedText'), notes: ref('LocalizedText'),
        keywords: object({ en: array(string), fr: array(string) }), metadata_modified: date, organization: nullable(ref('Organization')),
        places: array(ref('PlaceIdentity')), provenance: ref('Provenance'), presentation: ref('Presentation'), resources: array(ref('Resource')) }, ['id', 'name', 'resources', 'provenance']),
    Preparation: object({ supported: { type: 'boolean' }, enabled: { type: 'boolean' },
        freshness: { type: 'string', enum: ['unprepared', 'unknown', 'current', 'stale'] },
        state: { type: 'string', enum: ['unprepared', 'pending', 'running', 'failed', 'ready'] },
        job_id: { type: ['integer', 'null'], minimum: 1 }, retry_at: date, failure_reason: { type: ['string', 'null'], enum: failureReasons },
        prepared_at: date, publisher_modified_at: date }, ['supported', 'enabled', 'freshness', 'state', 'job_id', 'retry_at', 'failure_reason', 'prepared_at', 'publisher_modified_at']),
    Ingestion: object({ status: string, row_count: numberOrNull, ingested_at: date, fields: array(ref('Field')),
        byte_size: numberOrNull, columns: nullable(array(ref('Field'))), last_accessed_at: date }),
    MapMetadata: object({ available: { type: 'boolean', const: true }, provider: { type: 'string', enum: ['arcgis', 'canquery', 'pmtiles'] },
        geometry_type: { type: 'string', enum: ['point', 'multipoint', 'polyline', 'polygon', 'mixed'] }, extent: nullable(array({ type: 'number' })),
        fields: array(object({ name: string, alias: string, type: string })), indexed_at: date, version: string,
        min_zoom: integer, max_zoom: integer, layer: string, tiles: { ...string, description: 'Same-origin template containing {z}, {x}, {y}; use the current version.', 'x-description-fr': 'Modèle de même origine contenant {z}, {x}, {y}; utilisez la version actuelle.' } }),
    Resource: object({ id: string, dataset_id: string, name: ref('LocalizedText'), format: textOrNull, url: textOrNull, size_bytes: numberOrNull,
        datastore_active: { type: 'boolean' }, language: textOrNull, last_modified: date,
        query_mode: { type: 'string', enum: ['ingested', 'datastore', 'ingestable', 'file-only'], description: 'A ready local snapshot takes precedence. Map availability is independent of table query_mode.', 'x-description-fr': 'La copie locale prête a priorité. La disponibilité cartographique est indépendante du query_mode du tableau.' },
        preparation: ref('Preparation'), map: nullable(ref('MapMetadata')), ingestion: nullable(ref('Ingestion')), presentation: ref('Presentation'),
        dataset: object({ id: string, name: string, title: ref('LocalizedText'), organization: nullable(ref('Organization')) }),
        places: array(ref('PlaceIdentity')), provenance: ref('Provenance') }, ['id', 'dataset_id', 'query_mode', 'preparation', 'ingestion', 'map']),
    QueryResult: object({ fields: array(ref('Field')), records: array({ type: 'object', additionalProperties: true }), total: integer }, ['fields', 'records', 'total']),
    Aggregation: object({ group_by: string, agg: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, agg_column: textOrNull, bucket: { type: ['string', 'null'], enum: ['year', 'month', 'day', null] } }),
    Profile: object({ row_count: integer, columns: array(object({ id: string, type: string, distinct: integer, nulls: integer,
        min: scalar, max: scalar, avg: numberOrNull }, ['id', 'type', 'distinct', 'nulls'])) }, ['row_count', 'columns']),
    PreparationJob: object({ id: { type: ['integer', 'null'], minimum: 1 }, resource_id: string,
        status: { type: 'string', enum: ['pending', 'running', 'done'] }, already_loaded: { type: 'boolean' },
        row_count: numberOrNull, created_at: date, serving_cached: { type: 'boolean' }, prepared_at: date }, ['id', 'resource_id', 'status']),
    Job: object({ id: { type: ['integer', 'null'], minimum: 1 }, resource_id: string, status: { type: 'string', enum: ['pending', 'running', 'done', 'failed'] },
        attempts: integer, retry_at: date, failure_reason: { type: ['string', 'null'], enum: failureReasons }, error: textOrNull,
        created_at: date, claimed_at: date, finished_at: date, age_seconds: numberOrNull, already_loaded: { type: 'boolean' }, row_count: numberOrNull },
    ['id', 'resource_id', 'status', 'attempts', 'retry_at', 'failure_reason', 'error', 'created_at', 'claimed_at', 'finished_at', 'age_seconds']),
    FeatureCollection: object({ type: { type: 'string', const: 'FeatureCollection' }, features: array(object({ type: { type: 'string', const: 'Feature' },
        id: { type: ['string', 'number'] }, geometry: nullable(object({ type: string, coordinates: array({}), geometries: array({ type: 'object' }) })),
        properties: { type: 'object', additionalProperties: true } }, ['type', 'geometry', 'properties'])) }, ['type', 'features']),
    ViewportMetadata: object({ live: { type: 'boolean' }, provider: { type: 'string', enum: ['arcgis', 'canquery', 'pmtiles'] }, geometry_type: string,
        extent: nullable(array({ type: 'number' })), fields: array(object({ name: string, alias: string, type: string })), returned: integer,
        truncated: { type: 'boolean' }, indexed_at: date }),
    ActivityResource: object({ resource_id: string, name: ref('LocalizedText'), format: textOrNull, ingested_at: date, row_count: numberOrNull,
        hits: integer, last_queried_at: date, dataset: object({ id: string, name: string, title: ref('LocalizedText') }) }),
    Stats: object({ datasets: integer, resources: integer, datastore_active_resources: integer, ingested_resources: integer, mappable_resources: integer,
        store_bytes: integer, organizations: integer, places: integer, last_synced_at: date }),
    TopDownload: object({ rank: integer, dataset_id: string, title: ref('LocalizedText'), department: textOrNull, ministere: textOrNull, downloads: integer,
        history: array({ type: 'object' }), resource_id: textOrNull, ingest_status: textOrNull, row_count: numberOrNull }),
    FeaturedPreview: object({ dataset_id: string, title: ref('LocalizedText'), kind: { type: 'string', enum: ['bars', 'line', 'donut'] },
        points: array(object({ key: { type: ['string', 'null'] }, label: string, value: { type: 'number' } }, ['key', 'label', 'value'])),
        context: object({ resource_id: string, group_by: string, agg: { type: 'string', enum: ['count', 'avg'] }, agg_column: textOrNull,
            bucket: { type: ['string', 'null'], enum: ['year', 'month', 'day', null] }, group_type: string, snapshot_at: date,
            snapshot_rows: integer, total_groups: integer, displayed_groups: integer, limited: { type: 'boolean' }, missing_periods: array(string) }) }),
    Article: object({ id: string, lang: { type: 'string', enum: ['en', 'fr'] }, slug: string, path: string, title: string, description: string,
        place: textOrNull, placeName: string, topic: string, topicName: string, query: string, published: { type: 'string', format: 'date' },
        updated: { type: 'string', format: 'date' }, verified: { type: 'string', format: 'date' }, author: string, status: string,
        explore: string, view: { type: 'string', enum: ['table', 'map', 'download'] }, dataset: string, datasetId: string,
        translations: object({ en: string, fr: string }), bodyHtml: { ...string, description: 'Present on article detail; sanitized HTML.', 'x-description-fr': 'Présent dans le détail de l’article; HTML assaini.' } }),
    Health: object({ ok: { type: 'boolean' }, db: { type: 'boolean' }, upstream: { type: 'boolean' } }, ['ok', 'db', 'upstream']),
    Operations: object({ ok: { type: 'boolean' }, jobs: { type: 'object', additionalProperties: object({ last_ok_at: date,
        status: { type: 'string', enum: ['ok', 'pending', 'failed', 'stale'] } }) },
        maps: object({ pending: integer, deferred: integer, running: integer, ready: integer, skipped: integer, failed: integer, retrying_sources: integer,
            oldest_pending_at: date, next_retry_at: date, oldest_running_at: date, last_indexed_at: date, status: { type: 'string', enum: ['ok', 'degraded', 'stale'] } }),
        preparations: object({ pending: integer, running: integer, failed_last_day: integer, completed_last_day: integer, oldest_pending_at: date }) }, ['ok', 'jobs', 'maps', 'preparations'])
};

const headers = {
    'RateLimit-Limit': { description: 'Anonymous or failed-credential rate-limit ceiling when supplied by the limiter; keyed account limits are separate.', schema: integer },
    'RateLimit-Remaining': { description: 'Requests remaining in the limiter window, when supplied.', schema: integer },
    'RateLimit-Reset': { description: 'Seconds until the limiter window resets, when supplied.', schema: integer },
    'Deprecation': { description: 'Anonymous compatibility deprecation timestamp, when a cutoff is announced.', schema: string },
    'Sunset': { description: 'HTTP date after which metered routes require a key, when announced.', schema: string },
    'X-Request-Id': { description: 'Request identifier for support and log correlation.', schema: string },
    'Cache-Control': { description: 'Keyed API responses are private, no-store. Anonymous routes may use public caching.', schema: string },
    'X-CanQuery-Credits-Limit': { description: 'Keyed requests: shared account allowance for the current period.', schema: integer },
    'X-CanQuery-Credits-Remaining': { description: 'Keyed requests: remaining allowance after admission, including all outstanding reservations; not a final usage receipt.', schema: integer },
    'X-CanQuery-Credits-Reset': { description: 'Keyed requests: current allowance period end (UTC).', schema: { type: 'string', format: 'date-time' } }
};
const headerFrench = {
    'RateLimit-Limit': 'Plafond des requêtes anonymes ou des échecs d’authentification, lorsqu’il est fourni. Les limites du compte avec clé sont distinctes.',
    'RateLimit-Remaining': 'Requêtes restantes dans la fenêtre du limiteur, lorsqu’il est fourni.',
    'RateLimit-Reset': 'Secondes avant la réinitialisation de la fenêtre du limiteur, lorsqu’il est fourni.',
    Deprecation: 'Horodatage d’abandon de la compatibilité anonyme, lorsqu’une date limite est annoncée.',
    Sunset: 'Date HTTP après laquelle les routes comptabilisées exigent une clé, lorsqu’elle est annoncée.',
    'X-Request-Id': 'Identifiant de requête pour le soutien et la recherche dans les journaux.',
    'Cache-Control': 'Les réponses avec clé sont privées, no-store. Les routes anonymes peuvent utiliser un cache public.',
    'X-CanQuery-Credits-Limit': 'Avec clé : allocation partagée du compte pour la période actuelle.',
    'X-CanQuery-Credits-Remaining': 'Avec clé : solde après admission, comprenant toutes les réservations en cours; ce n’est pas un reçu d’utilisation définitif.',
    'X-CanQuery-Credits-Reset': 'Avec clé : fin de la période d’allocation actuelle (UTC).',
    'Retry-After': 'Si présent, nombre minimum de secondes avant un nouvel essai. Des crédits épuisés peuvent imposer d’attendre la prochaine période.',
    'Content-Disposition': 'Nom du fichier joint.',
    'X-CanQuery-Sources': 'Identifiants de sources séparés par des virgules, si disponibles.',
    Link: 'URL de la licence principale avec rel="license", si disponible.'
};
const publicHeaders = { 'X-Request-Id': headers['X-Request-Id'], 'Cache-Control': headers['Cache-Control'] };
const retryHeader = { description: 'When present, minimum seconds before retrying. Exhausted credits may require waiting until the next allowance period.', schema: { type: 'integer', minimum: 1 } };
const errorDescriptions = {
    400: ['Invalid parameters, unsupported filter/aggregation, or invalid coordinates.', 'Paramètres, filtres, agrégation ou coordonnées non valides.'],
    401: ['Missing required, invalid or revoked API key.', 'Clé requise manquante, non valide ou révoquée.'],
    403: ['Disabled key/account or disallowed browser origin.', 'Clé ou compte désactivé, ou origine du navigateur refusée.'],
    404: ['The requested identity or tile version was not found.', 'Identité ou version de tuile introuvable.'],
    409: ['No ready local copy, or the serving snapshot changed. Inspect metadata; use /prepare when supported.', 'Aucune copie locale prête, ou copie remplacée. Consultez les métadonnées et utilisez /prepare si disponible.'],
    413: ['Viewport exceeds the response/tile bound. Zoom in or reduce the viewport.', 'La vue dépasse la limite de réponse ou de tuiles. Zoomez ou réduisez la zone.'],
    422: ['Unsupported capability. Inspect metadata and use the original download when available.', 'Fonction non prise en charge. Consultez les métadonnées et le téléchargement original, si disponible.'],
    429: ['Limit reached. Distinguish QUOTA_EXCEEDED, RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY and PREPARATION_COOLDOWN; honour Retry-After.', 'Limite atteinte : crédits, fréquence, concurrence, capacité ou délai de préparation. Respectez Retry-After.'],
    500: ['Unexpected server failure. Retain X-Request-Id for support.', 'Erreur du serveur. Conservez X-Request-Id pour le soutien.'],
    502: ['Publisher DataStore, map source or tile storage unavailable.', 'DataStore, source cartographique ou stockage des tuiles indisponible.'],
    503: ['Service, accounts, accounting or bounded upstream concurrency temporarily unavailable.', 'Service, comptes, comptabilisation ou capacité temporairement indisponible.']
};
function errors(codes) {
    return Object.fromEntries([...new Set([401, 403, 429, 500, 503, ...codes])].map(code => [code, {
        description: errorDescriptions[code][0], 'x-description-fr': errorDescriptions[code][1],
        headers: { ...headers, 'Retry-After': retryHeader }, content: {
            'application/json': { schema: ref('Error'), example: { error: code === 429 ? 'Request rate exceeded' : errorDescriptions[code][0], request_id: 'example-request-id', ...(code === 429 ? { code: 'RATE_LIMIT', retry_after: 60 } : {}) } },
            ...(code === 429 ? { 'text/plain': { schema: string, example: 'Too many requests, please try again later.' } } : {})
        }
    }]));
}
function jsonResponse(schema, example, description = 'Successful response.', fr = 'Réponse réussie.') {
    return { description, 'x-description-fr': fr, headers, content: { 'application/json': { schema, ...(example !== undefined ? { example } : {}) } } };
}
function parameter(name, description, fr, schema = string, extra = {}) {
    return { name, in: 'query', description, 'x-description-fr': fr, schema, ...extra };
}
const search = parameter('q', 'Catalogue search text, trimmed; at most 200 characters.', 'Texte de recherche, espaces extérieurs retirés; 200 caractères maximum.', { type: 'string', maxLength: 200 }, { example: 'permits' });
const filter = (name, en, fr) => parameter(name, en, fr, { type: 'string', maxLength: 200 });
const cursor = parameter('cursor', 'Nonnegative offset. Pass pagination.nextCursor unchanged; omit for the first page.', 'Décalage positif ou nul. Réutilisez pagination.nextCursor; omettez-le à la première page.', { type: 'integer', minimum: 0, default: 0 }, { example: 20 });
const limit = (def, max) => parameter('limit', `Page size; values above ${max} are clamped to ${max}.`, `Taille de page; les valeurs supérieures à ${max} sont ramenées à ${max}.`, { type: 'integer', minimum: 1, maximum: max, default: def });
const place = filter('place', 'Canonical place ID or slug; includes configured inherited coverage.', 'Identifiant ou slug canonique du lieu; inclut la couverture héritée configurée.');
const language = parameter('lang', 'French when fr; otherwise English.', 'Français avec fr; anglais autrement.', { type: 'string', default: 'en' }, { example: 'en' });
const pathParameter = (name, description, fr, schema = string) => parameter(name, description, fr, schema, { in: 'path', required: true });
const resourceId = pathParameter('id', 'Resource ID from dataset or resource metadata.', 'Identifiant de ressource obtenu dans les métadonnées.');
const rowFilters = [
    parameter('q', 'Search within resource rows (not catalogue search); at most 200 characters. Local search uses case-insensitive ILIKE patterns.', 'Recherche dans les lignes, distincte du catalogue; 200 caractères maximum. Recherche locale ILIKE insensible à la casse.', { type: 'string', maxLength: 200 }),
    parameter('filters', 'URL-encoded JSON object, at most 2,000 characters and 20 column keys of 1–63 characters. Exact recorded field names; conditions combine with AND. Scalars mean equality. Objects use op and value: eq, lt, gt, lte, gte, contains. Live DataStore supports eq only. eq:null means IS NULL locally; contains preserves % and _ SQL wildcard meanings.', 'Objet JSON encodé dans l’URL : 2 000 caractères, 20 champs de 1 à 63 caractères maximum. Noms exacts, conditions AND. Scalaire = égalité; objets op/value : eq, lt, gt, lte, gte, contains. DataStore : eq seulement. Localement, eq:null signifie IS NULL; contains conserve les jokers SQL % et _.', { type: 'string', maxLength: 2000 }, { example: '{"STREET_NAME":"YONGE"}' }),
    parameter('sort', 'Exact field name, optionally followed by asc or desc. Local row sorting also accepts _id; aggregates accept key or value. An exact field name wins over a direction suffix. Live DataStore values are limited to 100 characters.', 'Nom exact du champ, suivi éventuellement de asc ou desc. Lignes locales : _id aussi accepté; agrégats : key ou value. Le nom exact a priorité sur le suffixe. DataStore : 100 caractères maximum.', string, { example: 'STREET_NAME asc' }),
    parameter('group_by', 'Prepared tables only: exact recorded grouping field. Required together with agg.', 'Tables préparées : champ de regroupement exact, obligatoire avec agg.', string, { example: 'STREET_NAME' }),
    parameter('agg', 'Prepared tables only. count forbids agg_column; other functions require it. sum/avg require a numeric field.', 'Tables préparées : count interdit agg_column; les autres fonctions l’exigent. sum/avg exigent un champ numérique.', { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, { example: 'count' }),
    parameter('agg_column', 'Recorded measure field for sum, avg, min or max; forbidden with count.', 'Champ de mesure pour sum, avg, min ou max; interdit avec count.'),
    parameter('bucket', 'Optional temporal grouping; group_by must be DATE or TIMESTAMPTZ.', 'Regroupement temporel facultatif; group_by doit être DATE ou TIMESTAMPTZ.', { type: 'string', enum: ['year', 'month', 'day'] })
];

// Synthetic examples demonstrate the contract, not current publisher measurements.
const synthetic = {
    source: { id: 'example-source', kind: 'ckan', name: { en: 'Example publisher', fr: 'Éditeur exemple' }, homepage_url: 'https://example.org/', landing_url: 'https://example.org/dataset/example', upstream: 'example.org', authoritative: true, license: null },
    dataset: { id: 'example-dataset', name: 'example-permits', title: { en: 'Example permits', fr: 'Permis exemples' }, metadata_modified: '2026-01-01T00:00:00.000Z' },
    preparation: { supported: true, enabled: true, freshness: 'unprepared', state: 'unprepared', job_id: null, retry_at: null, failure_reason: null, prepared_at: null, publisher_modified_at: '2026-01-01T00:00:00.000Z' }
};
const provenance = { sources: [synthetic.source], primary_license: null };
const resource = { id: 'example-resource', dataset_id: 'example-dataset', name: { en: 'Example CSV', fr: 'CSV exemple' }, format: 'CSV', url: 'https://example.org/example.csv', size_bytes: null, datastore_active: true, language: 'en', last_modified: '2026-01-01T00:00:00.000Z', query_mode: 'datastore', preparation: synthetic.preparation, map: null, ingestion: null, dataset: synthetic.dataset, places: [], provenance };
const rowExample = sample({ fields: [{ id: '_id', type: 'int' }, { id: 'STREET_NAME', type: 'text' }], records: [{ _id: 1, STREET_NAME: 'EXAMPLE' }], total: 1 }, { query_mode: 'datastore', provenance, sources: ['example-source'], upstream: 'example.org' });
const jobExample = { id: 123, resource_id: 'example-resource', status: 'pending', attempts: 0, retry_at: null, failure_reason: null, error: null, created_at: '2026-01-01T00:00:00.000Z', claimed_at: null, finished_at: null, age_seconds: 0 };

function buildOpenApi({ env = process.env, now = Date.now() } = {}) {
    const enabled = env.COMMERCIAL_API_ENABLED === 'true';
    const cutoff = enabled && env.API_KEY_REQUIRED_AT && Number.isFinite(Date.parse(env.API_KEY_REQUIRED_AT)) ? env.API_KEY_REQUIRED_AT : null;
    const anonymous = !cutoff || now < Date.parse(cutoff);
    const security = enabled ? (anonymous ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }]) : [{}];
    const configuredOffset = Number(env.MAX_QUERY_OFFSET);
    const maxOffset = env.MAX_QUERY_OFFSET !== undefined && env.MAX_QUERY_OFFSET !== '' && Number.isInteger(configuredOffset) && configuredOffset >= 0 ? configuredOffset : 10000;
    const configuredExport = Number(env.EXPORT_MAX_ROWS);
    const exportCap = Number.isInteger(configuredExport) && configuredExport > 0 ? Math.min(configuredExport, 10000) : 10000;
    const paths = {};
    const responseComponents = {};
    const headerComponents = {};
    function add(path, method, id, tag, summary, frSummary, description, frDescription, params, schema, example, codes = []) {
        const cost = path === '/healthz' || isPublicOperation({ path, method: method.toUpperCase() }) ? CREDIT_COSTS.activity
            : /\/(prepare|ingest)$/.test(path) ? `${CREDIT_COSTS.preparation} new job / ${CREDIT_COSTS.activity} existing`
                : /\/query$/.test(path) ? `${CREDIT_COSTS.query} row query / ${CREDIT_COSTS.aggregate} aggregation`
                    : operationFor({ path, query: {} }).cost;
        paths[path] ||= {};
        paths[path][method] = { operationId: id, tags: [tag], summary, 'x-summary-fr': frSummary, description, 'x-description-fr': frDescription,
            'x-credit-cost': cost, parameters: params, responses: { 200: jsonResponse(schema, example), ...errors(codes) } };
        return paths[path][method];
    }
    const catalogueDescription = 'Discover admitted catalogue records. Availability of metadata does not guarantee a working file, table or map. Catalogue reads never request preparation. Follow pagination.nextCursor until null.';
    const catalogueFrench = 'Découvrez les fiches admises. Des métadonnées présentes ne garantissent pas un fichier, tableau ou carte disponible. Aucune préparation automatique. Suivez pagination.nextCursor jusqu’à null.';
    add('/datasets', 'get', 'listDatasets', 'Discovery', 'Search datasets', 'Rechercher des jeux de données', catalogueDescription, catalogueFrench, [search, filter('org', 'Publisher name or identity.', 'Nom ou identifiant de l’éditeur.'), filter('format', 'Recorded resource format.', 'Format de ressource enregistré.'), filter('keyword', 'Recorded dataset keyword.', 'Mot-clé du jeu de données.'), place,
            filter('source', 'Catalogue source ID.', 'Identifiant de source du catalogue.'), parameter('mappable', 'Only datasets with maps. Use true or 1; omit to disable. false is invalid.', 'Jeux avec cartes seulement. Utilisez true ou 1; omettez pour désactiver. false est non valide.', { type: 'string', enum: ['true', '1'] }), limit(20, 100), cursor],
        envelope(array(ref('DatasetSummary'))), sample([{ ...synthetic.dataset, description: { en: 'Illustrative records.', fr: 'Données illustratives.' }, resource_count: 1, queryable_count: 1, mappable_count: 0, organization: null, places: [], provenance }], { search: { query: 'permits', suggestions: [] }, sources: ['example-source'] }, '20'), [400]);
    add('/datasets/{idOrName}', 'get', 'getDataset', 'Discovery', 'Get a dataset', 'Obtenir un jeu de données', 'Resolve a canonical dataset ID or published name/slug. Includes resources, capabilities and source-specific licence/provenance.', 'Résout un identifiant canonique ou un nom/slug publié. Inclut les ressources, capacités, licences et provenance.', [pathParameter('idOrName', 'Canonical dataset ID or published name/slug.', 'Identifiant canonique ou nom/slug publié.')], envelope(ref('Dataset')), sample({ ...synthetic.dataset, resources: [resource], provenance }), [404]);
    add('/organizations', 'get', 'listOrganizations', 'Discovery', 'List publishers', 'Lister les éditeurs', 'Literal bilingual publisher search with optional source/place scope. Uses catalogue pagination.', 'Recherche littérale bilingue des éditeurs, filtrable par source ou lieu. Pagination du catalogue.', [filter('q', 'Literal bilingual publisher search.', 'Recherche littérale bilingue des éditeurs.'), filter('source', 'Catalogue source ID.', 'Identifiant de source.'), place, limit(50, 100), cursor], envelope(array(ref('Organization'))), sample([{ id: 'example-org', name: 'example-publisher', title: synthetic.source.name, dataset_count: 1, place: null }]), [400]);
    add('/organizations/{name}', 'get', 'getOrganization', 'Discovery', 'Get a publisher', 'Obtenir un éditeur', 'Publisher identity, catalogue and capability counts, and place context.', 'Identité de l’éditeur, dénombrements du catalogue et des capacités, et lieu associé.', [pathParameter('name', 'Publisher name or identity, at most 200 characters.', 'Nom ou identifiant de l’éditeur, 200 caractères maximum.', { type: 'string', maxLength: 200 })], envelope(ref('Organization')), sample({ id: 'example-org', name: 'example-publisher', title: synthetic.source.name, dataset_count: 1, queryable_dataset_count: 1, mappable_dataset_count: 0, metadata_modified: null, place: null }), [400, 404]);
    add('/places', 'get', 'listPlaces', 'Discovery', 'List places', 'Lister les lieux', 'Search canonical geographical identities and their direct/inherited coverage. Uses catalogue pagination.', 'Recherche des lieux canoniques et de leur couverture directe ou héritée. Pagination du catalogue.', [search, parameter('kind', 'Place type.', 'Type de lieu.', { type: 'string', enum: kinds }), filter('parent', 'Canonical parent ID or slug.', 'Identifiant ou slug canonique du parent.'),
            parameter('featured', 'Use true or 1 for featured places; omit to disable.', 'Utilisez true ou 1 pour les lieux en vedette; omettez pour désactiver.', { type: 'string', enum: ['true', '1'] }), limit(50, 100), cursor], envelope(array(ref('Place'))), sample([{ id: 'example-place', slug: 'example-on', kind: 'municipality', name: { en: 'Example', fr: 'Exemple' }, featured: false, dataset_count: 1 }]), [400]);
    add('/places/{idOrSlug}', 'get', 'getPlace', 'Discovery', 'Get a place', 'Obtenir un lieu', 'Resolve a canonical ID, slug or durable alias. Includes ancestry, children, viewport and coverage. API lookup does not redirect like an HTML alias.', 'Résout un identifiant, slug ou alias durable. Inclut ascendance, enfants, vue et couverture. Aucun renvoi HTML pour les alias.', [pathParameter('idOrSlug', 'Canonical place ID, slug or historical alias.', 'Identifiant, slug ou alias historique du lieu.')], envelope(ref('Place')), sample({ id: 'example-place', slug: 'example-on', kind: 'municipality', name: { en: 'Example', fr: 'Exemple' }, ancestors: [], children: [], dataset_count: 1, direct_dataset_count: 1, mappable_dataset_count: 0 }), [404]);
    add('/sources', 'get', 'listSources', 'Discovery', 'List catalogue sources', 'Lister les sources du catalogue', 'Persisted publisher portals, provenance hosts, catalogue counts and last successful sync. This endpoint is not paginated.', 'Portails, hôtes de provenance, dénombrements et dernière synchronisation réussie. Sans pagination.', [place], envelope(array(ref('Source'))), sample([{ id: 'example-source', kind: 'ckan', name: synthetic.source.name, homepage_url: 'https://example.org/', catalog_url: 'https://example.org/api/3/action', upstream: 'example.org', dataset_count: 1, authoritative_dataset_count: 1, last_synced_at: null }]), [400]);
    add('/resources/{id}', 'get', 'getResource', 'Discovery', 'Inspect resource capabilities', 'Consulter les capacités d’une ressource', 'Read query_mode, preparation, ingestion, map and provenance before querying. A map can exist on a file-only table resource. Metadata reads neither prepare files nor renew local-copy activity. Preparation time differs from publisher modification time; source changes can remain undiscovered when publisher version metadata is unchanged.', 'Consultez query_mode, preparation, ingestion, map et provenance avant une requête. Une ressource file-only peut avoir une carte. La lecture ne prépare pas de fichier et ne renouvelle pas la copie locale. La date de préparation diffère de celle de l’éditeur; les changements sans modification des métadonnées de version peuvent passer inaperçus.', [resourceId], envelope(ref('Resource')), sample(resource), [404]);
    add('/resources/recently-unlocked', 'get', 'listRecentlyPrepared', 'Discovery', 'List recently prepared resources', 'Lister les ressources récemment préparées', 'Recent ready local copies. The historical route name is retained. Reading the list does not prepare files.', 'Copies locales prêtes récentes. Le nom historique de la route est conservé. Aucune préparation de fichier.', [place, limit(6, 20)], envelope(array(ref('ActivityResource'))), sample([{ resource_id: 'example-resource', name: resource.name, format: 'CSV', ingested_at: '2026-01-01T00:00:00.000Z', row_count: 1, dataset: synthetic.dataset }]), [400]);
    add('/resources/popular', 'get', 'listPopularResources', 'Discovery', 'List popular resources', 'Lister les ressources populaires', 'Counts CanQuery query-log hits, not publisher downloads.', 'Compte les requêtes enregistrées par CanQuery, pas les téléchargements de l’éditeur.', [place, parameter('days', 'Lookback days; values above 30 are clamped.', 'Jours précédents; les valeurs supérieures à 30 sont ramenées à 30.', { type: 'integer', minimum: 1, maximum: 30, default: 7 }), limit(6, 20)], envelope(array(ref('ActivityResource'))), sample([{ resource_id: 'example-resource', hits: 3, last_queried_at: '2026-01-01T00:00:00.000Z', name: resource.name, format: 'CSV', dataset: synthetic.dataset }]), [400]);
    const query = add('/resources/{id}/query', 'get', 'queryResource', 'Query and export', 'Query rows or aggregate', 'Interroger ou agréger les lignes',
        'Ready local snapshots take precedence over live CKAN DataStore. Live DataStore supports equality filters only, with no aggregation. Local aggregates cover the complete filtered snapshot; total then counts groups, not rows. Local reads renew copy activity and successful queries record popularity. Separate paginated requests do not promise an unchanged snapshot. A 409 never automatically enqueues preparation; inspect metadata and explicitly use /prepare when supported. Aggregations have an additional 30 requests/minute limit and consume expensive-request concurrency.',
        'La copie locale prête a priorité sur le DataStore CKAN. Le DataStore accepte seulement l’égalité, sans agrégation. Les agrégats locaux couvrent toute la copie filtrée; total compte alors les groupes. Les lectures locales renouvellent l’activité et les requêtes réussies alimentent la popularité. Des pages distinctes ne garantissent pas une copie inchangée. Un 409 ne lance aucune préparation; consultez les métadonnées et utilisez /prepare explicitement. Les agrégations sont aussi limitées à 30/minute et consomment la concurrence des requêtes coûteuses.',
        [resourceId, ...rowFilters, limit(20, 100), parameter('offset', 'Row/group offset; independent of catalogue cursor. Avoid relying on a stable snapshot across page calls.', 'Décalage de lignes/groupes, distinct du curseur du catalogue. Aucune copie stable garantie entre les pages.', { type: 'integer', minimum: 0, maximum: maxOffset, default: 0 })], envelope(ref('QueryResult')), rowExample, [400, 404, 409, 422, 502]);
    query['x-credit-cost-fr'] = `${CREDIT_COSTS.query} requête de lignes / ${CREDIT_COSTS.aggregate} agrégation`;
    query.responses[200].content['application/json'].examples = {
        rows: { summary: 'Illustrative live DataStore response', 'x-summary-fr': 'Exemple de réponse DataStore en direct', value: rowExample },
        aggregate: { summary: 'Illustrative complete-snapshot aggregate; numeric database values can be strings', 'x-summary-fr': 'Exemple d’agrégat de la copie complète; les nombres peuvent être des chaînes', value: sample({ fields: [{ id: 'key', type: 'TEXT' }, { id: 'value', type: 'INTEGER' }], records: [{ key: 'EXAMPLE', value: '2' }], total: 1 }, { query_mode: 'ingested', aggregation: { group_by: 'STREET_NAME', agg: 'count', agg_column: null, bucket: null }, provenance }) }
    };
    delete query.responses[200].content['application/json'].example;
    const csv = add('/resources/{id}/query.csv', 'get', 'exportResourceCsv', 'Query and export', 'Export a bounded CSV', 'Exporter un CSV limité',
        `Exports from offset zero, at most ${exportCap} rows (deployment cap; hard maximum 10,000). Same query capabilities as /query, including local full-snapshot aggregation before limiting groups. There is no CSV pagination or full-file guarantee. Use the original download for complete publisher files. Formula-like spreadsheet cells are neutralized. A failure after headers closes the partial response: discard incomplete output and retry within limits. Keyed failed/interrupted exports are refunded. Ten exports/minute plus plan request/concurrency limits.`,
        `Exporte à partir de zéro, au plus ${exportCap} lignes (limite de déploiement; plafond absolu de 10 000). Mêmes capacités que /query, y compris l’agrégation locale complète avant de limiter les groupes. Aucune pagination CSV ni garantie de fichier complet. Le téléchargement original donne le fichier de l’éditeur. Les formules de tableur sont neutralisées. Une erreur après les en-têtes ferme la réponse partielle : jetez ce fichier et réessayez dans les limites. Les exports authentifiés échoués ou interrompus sont remboursés. Dix exports/minute, sous réserve du forfait.`,
        [resourceId, ...rowFilters], undefined, undefined, [400, 404, 409, 422, 502]);
    csv.responses[200] = { description: 'CSV attachment (UTF-8); no JSON envelope.', 'x-description-fr': 'Pièce jointe CSV UTF-8, sans enveloppe JSON.', headers: { ...headers,
        'Content-Disposition': { description: 'Attachment filename.', schema: string }, 'X-CanQuery-Sources': { description: 'Comma-separated source IDs when available.', schema: string },
        Link: { description: 'Primary licence URL with rel="license", when available.', schema: string } }, content: { 'text/csv': { schema: string, example: '_id,STREET_NAME\n1,EXAMPLE\n' } } };
    add('/resources/{id}/profile', 'get', 'profileResource', 'Query and export', 'Profile a prepared table', 'Profiler une table préparée', 'Requires a ready local snapshot. Describes the whole file, not current filters. At most the first 60 recorded non-_id fields; numeric fields add min/max/avg and date fields min/max. Successful reads renew activity. Twenty requests/minute plus plan request/concurrency limits.', 'Exige une copie locale prête. Décrit le fichier entier, sans filtres. Les 60 premiers champs enregistrés hors _id au maximum; champs numériques avec min/max/avg, dates avec min/max. Renouvelle l’activité. Vingt requêtes/minute, sous réserve du forfait.', [resourceId], envelope(ref('Profile')), sample({ row_count: 1, columns: [{ id: 'STREET_NAME', type: 'TEXT', distinct: 1, nulls: 0 }] }, { query_mode: 'ingested', provenance }), [400, 404, 409, 422]);
    const prepare = add('/resources/{id}/prepare', 'post', 'prepareResource', 'Preparation', 'Prepare or refresh a file', 'Préparer ou actualiser un fichier',
        'No body. Returns 200 for a current copy or 202 for a new/shared job. Only a newly admitted job deducts preparation credits. A terminal failure without a result published by that job returns the actual debit to its original allowance period exactly once. Retries retain the charge; stopping polling does not fail the job. A failed refresh returns its own charge even if an older copy still serves. A successful empty table counts as success; later expiry or eviction does not return credits. This is an account-credit reversal, not a payment refund. Current copies, joins and polling cost zero but still count toward request limits. Keyed new jobs are capped at 20/account/hour; anonymous admission has a configured per-IP limit. A shared active-queue ceiling and format/size/row/column/storage caps also apply. A stale copy can continue serving during refresh. Paused admission returns 429 even for current copies. Honour cooldown Retry-After; a new source version can bypass the old cooldown. No scheduled-refresh guarantee.',
        'Sans corps. Retourne 200 pour une copie actuelle ou 202 pour une tâche nouvelle/partagée. Seule une nouvelle admission déduit des crédits. Un échec définitif sans publication par cette tâche rend une seule fois le débit réel à sa période d’origine. Les réessais gardent le débit; arrêter le suivi ne fait pas échouer la tâche. Un renouvellement échoué rend son débit même si une ancienne copie reste disponible. Une table vide valide compte comme un succès; son expiration ultérieure ne rend pas les crédits. Aucun remboursement de paiement. Copie actuelle, tâche partagée et suivi : zéro crédit, mais comptent dans la fréquence. Maximum de 20 admissions/compte/heure avec clé; limite anonyme par IP configurée. La file commune et les plafonds de format, taille, lignes, colonnes et stockage s’appliquent. Une ancienne copie peut rester disponible. Une pause donne 429 même pour une copie actuelle. Respectez Retry-After; une nouvelle version peut contourner l’ancien délai. Aucune actualisation planifiée garantie.',
        [resourceId], envelope(ref('PreparationJob')), sample({ id: null, resource_id: 'example-resource', status: 'done', already_loaded: true, row_count: 1, prepared_at: '2026-01-01T00:00:00.000Z' }), [404, 422]);
    prepare['x-credit-cost-fr'] = `${CREDIT_COSTS.preparation} nouvelle tâche / ${CREDIT_COSTS.activity} existante`;
    prepare.responses[202] = jsonResponse(envelope(ref('PreparationJob')), sample({ id: 123, resource_id: 'example-resource', status: 'pending', created_at: '2026-01-01T00:00:00.000Z', serving_cached: false, prepared_at: null }), 'New or shared job. Poll GET /jobs/{id}, then re-read resource metadata.', 'Tâche nouvelle ou partagée. Suivez GET /jobs/{id}, puis relisez les métadonnées.');
    const ingest = add('/resources/{id}/ingest', 'post', 'ingestResourceLegacy', 'Preparation', 'Prepare a file (legacy)', 'Préparer un fichier (historique)', 'No body. Compatibility endpoint; new integrations should use /prepare for freshness and refresh. It returns an existing ready copy without refreshing stale data. Five requests/hour, plus shared limits. New-job charging matches /prepare.', 'Sans corps. Compatibilité : utilisez /prepare pour gérer l’actualité et le renouvellement. Renvoie une copie prête sans actualiser une copie ancienne. Cinq requêtes/heure, plus les limites communes. Même coût d’admission que /prepare.', [resourceId], envelope(ref('Job')), sample({ ...jobExample, id: null, status: 'done', already_loaded: true, row_count: 1 }), [404, 422]);
    ingest.deprecated = true;
    ingest['x-credit-cost-fr'] = prepare['x-credit-cost-fr'];
    ingest.responses[202] = jsonResponse(envelope(ref('Job')), sample(jobExample), 'New or shared legacy preparation job.', 'Tâche de préparation historique nouvelle ou partagée.');
    const activity = add('/resources/{id}/activity', 'post', 'renewResourceActivity', 'Preparation', 'Renew local-copy activity', 'Renouveler l’activité d’une copie', 'No body. Renews an existing ready copy without preparing a file or recording popularity. A 409 means the copy is unavailable or replaced; re-read metadata. Zero credits still counts toward request limits.', 'Sans corps. Renouvelle une copie prête, sans préparation ni popularité. Un 409 indique une copie absente ou remplacée : relisez les métadonnées. Zéro crédit compte toujours dans la fréquence.', [resourceId], undefined, undefined, [404, 409]);
    delete activity.responses[200];
    activity.responses[204] = { description: 'Activity renewed; empty body.', 'x-description-fr': 'Activité renouvelée; corps vide.', headers };
    add('/jobs/{id}', 'get', 'getPreparationJob', 'Preparation', 'Poll a preparation job', 'Suivre une tâche de préparation', 'Poll one request at a time with a bounded delay and honour Retry-After on errors. A done job is historical: re-read resource metadata before querying because a prepared copy may expire. Failure messages are sanitized; failure_reason and retry_at explain retry eligibility. Zero credits still counts toward request limits.', 'Une requête de suivi à la fois, avec délai borné; respectez Retry-After en cas d’erreur. Une tâche done est historique : relisez les métadonnées, car une copie peut expirer. Messages assainis; failure_reason et retry_at décrivent le nouvel essai. Zéro crédit compte dans la fréquence.', [pathParameter('id', 'Positive job ID returned by preparation.', 'Identifiant positif reçu lors de la préparation.', { type: 'integer', minimum: 1 })], envelope(ref('Job')), sample(jobExample), [400, 404]);
    add('/resources/{id}/map', 'get', 'getMapViewport', 'Maps', 'Get a bounded map viewport', 'Obtenir une vue cartographique limitée', 'Enveloped WGS84 GeoJSON for admitted ArcGIS, local PostGIS or PMTiles maps. live=true identifies the viewport interface; it does not promise a publisher fetch on every call. Check returned/truncated; requests are capped at 1,000 features and 8 MiB. PMTiles viewport decoding also bounds tile count. Sixty viewport calls/minute plus plan request/concurrency limits.', 'GeoJSON WGS84 enveloppé pour ArcGIS, PostGIS local ou PMTiles admis. live=true désigne l’interface, pas une lecture de l’éditeur à chaque appel. Consultez returned/truncated : 1 000 entités et 8 Mio maximum. Le décodage PMTiles limite aussi les tuiles. Soixante appels/minute, sous réserve du forfait.', [resourceId, parameter('bbox', 'Required WGS84 west,south,east,north: -180 ≤ west < east ≤ 180 and -90 ≤ south < north ≤ 90.', 'Requis : ouest,sud,est,nord en WGS84. -180 ≤ ouest < est ≤ 180; -90 ≤ sud < nord ≤ 90.', string, { required: true, example: '-79.5,43.6,-79.3,43.8' }),
            parameter('zoom', 'Integer zoom level.', 'Niveau de zoom entier.', { type: 'integer', minimum: 0, maximum: 22, default: 11 }), parameter('limit', 'Feature ceiling; out-of-range values return 400.', 'Plafond d’entités; hors limites : 400.', { type: 'integer', minimum: 1, maximum: 1000, default: 1000 })],
        envelope(ref('FeatureCollection')), sample({ type: 'FeatureCollection', features: [] }, { map: { live: true, provider: 'arcgis', geometry_type: 'point', fields: [], returned: 0, truncated: false, indexed_at: null }, provenance }), [400, 413, 422, 502]);
    const tile = add('/resources/{id}/map/tiles/{version}/{z}/{x}/{y}.pbf', 'get', 'getMapTile', 'Maps', 'Get a vector tile', 'Obtenir une tuile vectorielle', 'PMTiles maps only. Copy the current tiles template/version and zoom range from resource metadata. Coordinates must fit the tile grid and archive zoom range. Anonymous successful tiles cache immutably for one year; keyed responses remain private, no-store. Up to 240 tiles/minute, also subject to the keyed plan request limit.', 'Cartes PMTiles seulement. Utilisez le modèle tiles, la version et la plage de zoom des métadonnées. Les coordonnées doivent respecter la grille et l’archive. Cache anonyme immuable d’un an; réponses avec clé privées, no-store. Maximum de 240 tuiles/minute, et limite du forfait avec clé.', [resourceId, pathParameter('version', 'Current map version from resource metadata.', 'Version actuelle issue des métadonnées.'),
            pathParameter('z', 'Zoom within this archive’s min_zoom/max_zoom (0–22).', 'Zoom dans min_zoom/max_zoom de l’archive (0–22).', { type: 'integer', minimum: 0, maximum: 22 }),
            ...['x', 'y'].map(name => pathParameter(name, 'Tile coordinate from 0 through 2^z − 1.', 'Coordonnée de 0 à 2^z − 1.', { type: 'integer', minimum: 0 }))], undefined, undefined, [400, 404, 502]);
    tile.responses[200] = { description: 'Vector-tile protobuf bytes; no JSON envelope.', 'x-description-fr': 'Octets protobuf de la tuile, sans enveloppe JSON.', headers, content: { 'application/x-protobuf': { schema: { type: 'string', format: 'binary' } } } };
    tile.responses[204] = { description: 'No tile at these coordinates; empty body.', 'x-description-fr': 'Aucune tuile à ces coordonnées; corps vide.', headers };
    add('/stats', 'get', 'getCatalogueStats', 'Discovery', 'Get catalogue statistics', 'Obtenir les statistiques du catalogue', 'Briefly cached counts; capabilities overlap. These are dated observations, not guaranteed coverage or publisher availability.', 'Dénombrements brièvement mis en cache; les capacités se chevauchent. Observations datées, sans garantie de couverture ni de disponibilité.', [], envelope(ref('Stats')), sample({ datasets: 1, resources: 1, datastore_active_resources: 1, ingested_resources: 0, mappable_resources: 0, store_bytes: 0, organizations: 1, places: 1, last_synced_at: null }));
    add('/insights/top-downloads', 'get', 'getTopDownloads', 'Guides and insights', 'Get the publisher download leaderboard', 'Obtenir le classement des téléchargements', 'Publisher-reported download statistics with selected representatives. Distinct from CanQuery query popularity; meta.period identifies the reporting month.', 'Statistiques de téléchargements de l’éditeur et ressources représentatives. Distinctes de la popularité CanQuery; meta.period précise le mois.', [language], envelope(array(ref('TopDownload'))), sample([{ rank: 1, dataset_id: 'example-dataset', title: synthetic.dataset.title, department: 'Example', ministere: 'Exemple', downloads: 10, history: [], resource_id: 'example-resource', ingest_status: null, row_count: null }], { period: { year: 2026, month: 1 } }));
    add('/insights/featured', 'get', 'getFeaturedPreviews', 'Guides and insights', 'Get prepared chart previews', 'Obtenir les aperçus de graphiques', 'Up to 12 validated previews from already prepared Top 100 representatives. No preparation is admitted. Context gives aggregation, snapshot time, displayed/total groups and known missing metrics; this is neither a chart-rendering API nor a scheduled-refresh service.', 'Jusqu’à 12 aperçus validés de ressources du Top 100 déjà préparées. Aucune préparation. Le contexte précise agrégat, date de copie, groupes et mesures manquantes connues; ce n’est ni une API de rendu ni un service d’actualisation planifiée.', [language], envelope(array(ref('FeaturedPreview'))), sample([]));
    add('/blog', 'get', 'listGuides', 'Guides and insights', 'List data guides', 'Lister les guides de données', 'Published guide summaries; reads bundled content without querying the catalogue.', 'Résumés des guides publiés; lit le contenu inclus sans consulter le catalogue.', [parameter('lang', 'Guide language; must be en or fr.', 'Langue des guides : en ou fr.', { type: 'string', enum: ['en', 'fr'], default: 'en' }), parameter('place', 'Guide place slug.', 'Slug du lieu associé au guide.'), parameter('dataset', 'Canonical dataset ID or published slug.', 'Identifiant canonique ou slug publié du jeu.')], envelope(array(ref('Article'))), sample([]), [400]);
    add('/blog/{lang}/{slug}', 'get', 'getGuide', 'Guides and insights', 'Get a data guide', 'Obtenir un guide de données', 'Published guide edition including sanitized bodyHtml and translation links.', 'Édition publiée avec bodyHtml assaini et liens des traductions.', [pathParameter('lang', 'Guide edition language.', 'Langue de l’édition.', { type: 'string', enum: ['en', 'fr'] }), pathParameter('slug', 'Published localized guide slug.', 'Slug localisé du guide publié.')], envelope(ref('Article')), sample({ id: 'example-guide', lang: 'en', slug: 'example-guide', path: '/blog/example-guide', title: 'Example guide', description: 'Illustrative guide.', bodyHtml: '<p>Example guide content.</p>', translations: { en: '/blog/example-guide', fr: '/fr/blog/guide-exemple' } }), [404]);
    add('/repo', 'get', 'getRepositoryMetadata', 'Guides and insights', 'Get repository metadata', 'Obtenir les métadonnées du dépôt', 'Cached public GitHub star count. data may be null when GitHub is unavailable.', 'Nombre d’étoiles GitHub publiques en cache. data peut être null si GitHub est indisponible.', [], envelope(nullable(object({ stars: integer }))), sample({ stars: 1 }, { source: 'github', upstream: 'api.github.com' }));
    const opsSample = sample({ ok: true, jobs: { full: { last_ok_at: '2026-01-01T00:00:00.000Z', status: 'ok' } }, maps: { pending: 0, deferred: 0, running: 0, ready: 0, skipped: 0, failed: 0, retrying_sources: 0, oldest_pending_at: null, next_retry_at: null, oldest_running_at: null, last_indexed_at: null, status: 'ok' }, preparations: { pending: 0, running: 0, failed_last_day: 0, completed_last_day: 0, oldest_pending_at: null } });
    const ops = add('/ops', 'get', 'getOperations', 'Operations', 'Inspect job and map health', 'Consulter la santé des tâches et cartes', 'Public and unmetered. HTTP 200 or 503 uses the same envelope according to data.ok. Preparation counters alone do not change ok; inspect queue age and worker state separately. Health does not guarantee every file is available.', 'Public, sans crédits. HTTP 200 ou 503 utilise la même enveloppe selon data.ok. Les compteurs de préparation ne changent pas seuls ok; vérifiez séparément l’âge de la file et les processus. Aucune garantie pour chaque fichier.', [], envelope(ref('Operations')), opsSample);
    ops.security = [];
    ops.responses = { 200: jsonResponse(envelope(ref('Operations')), opsSample), 503: jsonResponse(envelope(ref('Operations')), { ...opsSample, data: { ...opsSample.data, ok: false, jobs: { full: { last_ok_at: null, status: 'failed' } } } }, 'A job or map health check is degraded.', 'Une tâche ou une vérification cartographique est dégradée.'), 429: errors([])[429], 500: errors([])[500] };
    for (const code of [200, 503]) ops.responses[code].headers = publicHeaders;
    const health = add('/healthz', 'get', 'getHealth', 'Operations', 'Check database and federal upstream', 'Vérifier la base et la source fédérale', 'Site-root path /healthz (not /api/v1/healthz). Public, unmetered, unenveloped reachability check; not a worker or catalogue-wide availability check.', 'Route racine /healthz (pas /api/v1/healthz). Vérification publique sans crédits ni enveloppe; ne vérifie pas les processus ni tous les fichiers.', [], ref('Health'), { ok: true, db: true, upstream: true });
    health.servers = [{ url: '/' }];
    health.security = [];
    health.responses = { 200: jsonResponse(ref('Health'), { ok: true, db: true, upstream: true }), 503: jsonResponse(ref('Health'), { ok: false, db: false, upstream: true }, 'Database or federal upstream probe failed.', 'La base ou la source fédérale ne répond pas.') };
    for (const response of Object.values(health.responses)) response.headers = publicHeaders;
    const spec = add('/openapi.json', 'get', 'getOpenApi', 'Operations', 'Download the OpenAPI contract', 'Télécharger le contrat OpenAPI', 'Public, unmetered OpenAPI 3.1 document. Import into compatible developer tools. Examples are synthetic and do not establish current publisher data or availability.', 'Document OpenAPI 3.1 public, sans crédits. Importez-le dans vos outils compatibles. Exemples synthétiques, sans garantie de données ou disponibilité actuelles.', [], { type: 'object', required: ['openapi', 'info', 'paths'], properties: { openapi: string, info: { type: 'object' }, paths: { type: 'object' } } });
    spec.security = [];
    spec.responses = { 200: jsonResponse({ type: 'object' }), 429: errors([])[429] };
    spec.responses[200].headers = publicHeaders;
    // Share response/header definitions so the browsable contract stays small.
    for (const pathItem of Object.values(paths)) {
        for (const operation of Object.values(pathItem)) {
            for (const [status, response] of Object.entries(operation.responses)) {
                if (response.headers) {
                    response.headers = Object.fromEntries(Object.entries(response.headers).map(([name, definition]) => {
                        headerComponents[name] = { ...definition, 'x-description-fr': headerFrench[name] };
                        return [name, { $ref: '#/components/headers/' + name }];
                    }));
                }
                if (response.content?.['application/json']?.schema?.$ref === '#/components/schemas/Error') {
                    responseComponents['Error' + status] = response;
                    operation.responses[status] = { $ref: '#/components/responses/Error' + status };
                }
            }
        }
    }
    return {
        openapi: '3.1.0', info: { title: 'CanQuery API', version: '1.0.0', contact: { email: 'support@canquery.com' },
            description: 'Hosted access to admitted Canadian open-data catalogues, supported tables and bounded maps. Store API keys server-side and send Authorization: Bearer YOUR_API_KEY; never place keys in a URL or browser bundle. Keys share account credits, request rates and expensive-request concurrency. Free allowances use UTC calendar months; Business uses confirmed paid periods. Cached successes count. Failed/interrupted ordinary requests are refunded; newly admitted preparation deducts credits until its final outcome; terminal failure without a published result reverses the original debit once, in its original allowance period. Internal retries keep the debit, and client timeouts do not fail jobs. Successful publication remains charged after expiry or eviction. These are credit returns, not cash refunds. No rollover or automatic overages. Successful JSON routes use data/pagination/meta except /healthz; CSV, tiles and 204 responses are exceptions. Error bodies are not enveloped. Examples use synthetic fixtures, not current observations. Publisher licences remain applicable. See /docs for runnable quickstarts.',
            'x-description-fr': 'Accès hébergé aux catalogues canadiens admis, aux tables prises en charge et aux cartes limitées. Gardez les clés côté serveur : Authorization: Bearer YOUR_API_KEY, jamais dans l’URL ou le navigateur. Les clés partagent crédits, fréquence et concurrence du compte. Forfait gratuit : mois UTC; Business : périodes payées confirmées. Les succès en cache comptent. Les requêtes ordinaires échouées/interrompues sont remboursées; les crédits d’admission sont rendus une seule fois à leur période d’origine en cas d’échec définitif sans publication. Les réessais gardent le débit; un délai client n’est pas un échec de tâche. Une préparation réussie reste facturée après expiration. Ce retour de crédits n’est pas un remboursement de paiement. Aucun report ni dépassement automatique. Enveloppe data/pagination/meta sauf /healthz, CSV, tuiles et 204. Erreurs sans enveloppe. Exemples synthétiques. Les licences des éditeurs s’appliquent. Consultez /docs.' },
        servers: [{ url: '/api/v1', description: 'Developer API on this host. /healthz overrides this base.' }],
        security, 'x-authentication': { accounts_enabled: enabled, anonymous_access: anonymous, api_key_required_at: cutoff },
        'x-credit-costs': CREDIT_COSTS, 'x-workflow-costs': WORKFLOW_COSTS,
        'x-limits': { row_limit: 100, query_offset: maxOffset, csv_rows: exportCap, map_features: 1000, map_bytes: 8 * 1024 * 1024, keyed_preparations_per_account_hour: 20 },
        tags: [['Discovery', 'Découverte'], ['Query and export', 'Requêtes et export'], ['Preparation', 'Préparation'], ['Maps', 'Cartes'], ['Guides and insights', 'Guides et analyses'], ['Operations', 'Opérations']].map(([name, fr]) => ({ name, 'x-display-name-fr': fr })),
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'CanQuery API key', description: enabled ? (anonymous ? 'Optional during anonymous compatibility. An explicit invalid key is rejected; omit Authorization only for anonymous requests. Any announced cutoff applies at API_KEY_REQUIRED_AT.' : 'Required for metered developer routes; /ops, /openapi.json and site-root /healthz remain public.') : 'API accounts are disabled on this deployment. Anonymous requests are available; requests presenting an API key return 503.' } }, schemas, responses: responseComponents, headers: headerComponents }, paths
    };
}

module.exports = { buildOpenApi, createOpenApi: buildOpenApi };
