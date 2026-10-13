// Hosted canquery.com additions to the core OpenAPI contract: API-key security,
// credit costs, keyed headers and the hosted wording of shared definitions and
// metered operations. Generated from the pre-extension core output, so the text
// matches what canquery.com published before the extension hooks.
const { CREDIT_COSTS, WORKFLOW_COSTS } = require('./services/commercialConfig');
const { operationFor, isPublicOperation } = require('./services/commercialOperations');

// Response headers in their published order, and the hosted French wording.
const HEADERS = {
    "RateLimit-Limit": {
        "description": "Anonymous or failed-credential rate-limit ceiling when supplied by the limiter; keyed account limits are separate.",
        "schema": {
            "type": "integer",
            "minimum": 0
        }
    },
    "RateLimit-Remaining": {
        "description": "Requests remaining in the limiter window, when supplied.",
        "schema": {
            "type": "integer",
            "minimum": 0
        }
    },
    "RateLimit-Reset": {
        "description": "Seconds until the limiter window resets, when supplied.",
        "schema": {
            "type": "integer",
            "minimum": 0
        }
    },
    "Deprecation": {
        "description": "Anonymous compatibility deprecation timestamp, when a cutoff is announced.",
        "schema": {
            "type": "string"
        }
    },
    "Sunset": {
        "description": "HTTP date after which metered routes require a key, when announced.",
        "schema": {
            "type": "string"
        }
    },
    "X-Request-Id": {
        "description": "Request identifier for support and log correlation.",
        "schema": {
            "type": "string"
        }
    },
    "Cache-Control": {
        "description": "Keyed API responses are private, no-store. Anonymous routes may use public caching.",
        "schema": {
            "type": "string"
        }
    },
    "X-CanQuery-Credits-Limit": {
        "description": "Keyed requests: shared account allowance for the current period.",
        "schema": {
            "type": "integer",
            "minimum": 0
        }
    },
    "X-CanQuery-Credits-Remaining": {
        "description": "Keyed requests: remaining allowance after admission, including all outstanding reservations; not a final usage receipt.",
        "schema": {
            "type": "integer",
            "minimum": 0
        }
    },
    "X-CanQuery-Credits-Reset": {
        "description": "Keyed requests: current allowance period end (UTC).",
        "schema": {
            "type": "string",
            "format": "date-time"
        }
    }
};
const HEADER_FRENCH = {
    "RateLimit-Limit": "Plafond des requêtes anonymes ou des échecs d’authentification, lorsqu’il est fourni. Les limites du compte avec clé sont distinctes.",
    "Deprecation": "Horodatage d’abandon de la compatibilité anonyme, lorsqu’une date limite est annoncée.",
    "Sunset": "Date HTTP après laquelle les routes comptabilisées exigent une clé, lorsqu’elle est annoncée.",
    "Cache-Control": "Les réponses avec clé sont privées, no-store. Les routes anonymes peuvent utiliser un cache public.",
    "X-CanQuery-Credits-Limit": "Avec clé : allocation partagée du compte pour la période actuelle.",
    "X-CanQuery-Credits-Remaining": "Avec clé : solde après admission, comprenant toutes les réservations en cours; ce n’est pas un reçu d’utilisation définitif.",
    "X-CanQuery-Credits-Reset": "Avec clé : fin de la période d’allocation actuelle (UTC).",
    "Retry-After": "Si présent, nombre minimum de secondes avant un nouvel essai. Des crédits épuisés peuvent imposer d’attendre la prochaine période."
};
const RETRY_DESCRIPTION = "When present, minimum seconds before retrying. Exhausted credits may require waiting until the next allowance period.";
const ERRORS = {
    "401": [
        "Missing required, invalid or revoked API key.",
        "Clé requise manquante, non valide ou révoquée."
    ],
    "403": [
        "Disabled key/account or disallowed browser origin.",
        "Clé ou compte désactivé, ou origine du navigateur refusée."
    ],
    "429": [
        "Limit reached. Distinguish QUOTA_EXCEEDED, RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY, PREPARATION_COOLDOWN and AUTOMATED_CLIENT; honour Retry-After.",
        "Limite atteinte : crédits, fréquence, concurrence, capacité, délai de préparation ou robot d’indexation. Respectez Retry-After."
    ],
    "503": [
        "Service, accounts, accounting or bounded upstream concurrency temporarily unavailable.",
        "Service, comptes, comptabilisation ou capacité temporairement indisponible."
    ]
};
const ERROR_CODES = [
    "Examples: INVALID_API_KEY, API_KEY_REQUIRED, KEY_DISABLED, ACCOUNT_SUSPENDED, QUOTA_EXCEEDED, RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY, PREPARATION_COOLDOWN, AUTOMATED_CLIENT, SNAPSHOT_UNAVAILABLE, ACCOUNTING_UNAVAILABLE.",
    "Exemples : INVALID_API_KEY, API_KEY_REQUIRED, KEY_DISABLED, ACCOUNT_SUSPENDED, QUOTA_EXCEEDED, RATE_LIMIT, CONCURRENCY_LIMIT, PREPARATION_BUSY, PREPARATION_COOLDOWN, AUTOMATED_CLIENT, SNAPSHOT_UNAVAILABLE, ACCOUNTING_UNAVAILABLE."
];
const INFO = [
    "Hosted access to admitted Canadian open-data catalogues, supported tables and bounded maps. Store API keys server-side and send Authorization: Bearer YOUR_API_KEY; never place keys in a URL or browser bundle. Keys share account credits, request rates and expensive-request concurrency. Free allowances use UTC calendar months; Business uses confirmed paid periods. Cached successes count. Failed/interrupted ordinary requests are refunded; newly admitted preparation deducts credits until its final outcome; terminal failure without a published result reverses the original debit once, in its original allowance period. Internal retries keep the debit, and client timeouts do not fail jobs. Successful publication remains charged after expiry or eviction. These are credit returns, not cash refunds. No rollover or automatic overages. Successful JSON routes use data/pagination/meta except /healthz; CSV, tiles and 204 responses are exceptions. Error bodies are not enveloped. Examples use synthetic fixtures, not current observations. Publisher licences remain applicable. See /docs for runnable quickstarts.",
    "Accès hébergé aux catalogues canadiens admis, aux tables prises en charge et aux cartes limitées. Gardez les clés côté serveur : Authorization: Bearer YOUR_API_KEY, jamais dans l’URL ou le navigateur. Les clés partagent crédits, fréquence et concurrence du compte. Forfait gratuit : mois UTC; Business : périodes payées confirmées. Les succès en cache comptent. Les requêtes ordinaires échouées/interrompues sont remboursées; les crédits d’admission sont rendus une seule fois à leur période d’origine en cas d’échec définitif sans publication. Les réessais gardent le débit; un délai client n’est pas un échec de tâche. Une préparation réussie reste facturée après expiration. Ce retour de crédits n’est pas un remboursement de paiement. Aucun report ni dépassement automatique. Enveloppe data/pagination/meta sauf /healthz, CSV, tuiles et 204. Erreurs sans enveloppe. Exemples synthétiques. Les licences des éditeurs s’appliquent. Consultez /docs."
];
const SECURITY = {
    "anonymous": "Optional during anonymous compatibility. An explicit invalid key is rejected; omit Authorization only for anonymous requests. Any announced cutoff applies at API_KEY_REQUIRED_AT.",
    "required": "Required for metered developer routes; /ops, /openapi.json and site-root /healthz remain public.",
    "disabled": "API accounts are disabled on this deployment. Anonymous requests are available; requests presenting an API key return 503."
};
const COST_FRENCH = {
    query: `${CREDIT_COSTS.query} requête de lignes / ${CREDIT_COSTS.aggregate} agrégation`,
    preparation: `${CREDIT_COSTS.preparation} nouvelle tâche / ${CREDIT_COSTS.activity} existante`
};

function descriptions({ exportCap }) {
    return {
        queryResource: ["Ready local snapshots take precedence over live CKAN DataStore. Live DataStore supports equality filters only, with no aggregation. Local aggregates cover the complete filtered snapshot; total then counts groups, not rows. Local reads renew copy activity and successful queries record popularity. Local responses include meta.snapshot, retrieval time and deployment limits. Supply snapshot on subsequent pages to require identical stored rows and schema; 409 requires an explicit new extraction. Catalogue provenance and publisher modification timestamps are observed at retrieval, not frozen at preparation. source_metadata_version is not a downloaded-content checksum. A 409 never automatically enqueues preparation; inspect metadata and explicitly use /prepare when supported. Aggregations have an additional 30 requests/minute limit and consume expensive-request concurrency.",
            "La copie locale prête a priorité sur le DataStore CKAN. Le DataStore accepte seulement l’égalité, sans agrégation. Les agrégats locaux couvrent toute la copie filtrée; total compte alors les groupes. Les lectures locales renouvellent l’activité et les requêtes réussies alimentent la popularité. Les réponses locales comprennent meta.snapshot, la date de récupération et les limites. Fournissez snapshot aux pages suivantes pour conserver les mêmes données et champs; un 409 exige une nouvelle extraction explicite. La provenance est observée à la récupération. source_metadata_version ne vérifie pas le contenu du fichier. Un 409 ne lance aucune préparation; consultez les métadonnées et utilisez /prepare explicitement. Les agrégations sont aussi limitées à 30/minute et consomment la concurrence des requêtes coûteuses."],
        exportResourceCsv: [`Exports from offset zero, at most ${exportCap} rows (deployment cap; hard maximum 10,000). Same query capabilities as /query, including local full-snapshot aggregation before limiting groups. There is no CSV pagination or full-file guarantee. Use the original download for complete publisher files. Formula-like spreadsheet cells are neutralized. A failure after headers closes the partial response: discard incomplete output and retry within limits. Keyed failed/interrupted exports are refunded. Ten exports/minute plus plan request/concurrency limits.`,
            `Exporte à partir de zéro, au plus ${exportCap} lignes (limite de déploiement; plafond absolu de 10 000). Mêmes capacités que /query, y compris l’agrégation locale complète avant de limiter les groupes. Aucune pagination CSV ni garantie de fichier complet. Le téléchargement original donne le fichier de l’éditeur. Les formules de tableur sont neutralisées. Une erreur après les en-têtes ferme la réponse partielle : jetez ce fichier et réessayez dans les limites. Les exports authentifiés échoués ou interrompus sont remboursés. Dix exports/minute, sous réserve du forfait.`],
        profileResource: ["Requires a ready local snapshot. Describes the whole file, not current filters. At most the first 60 recorded non-_id fields; numeric fields add min/max/avg and date fields min/max. Successful reads renew activity. Twenty requests/minute plus plan request/concurrency limits.",
            "Exige une copie locale prête. Décrit le fichier entier, sans filtres. Les 60 premiers champs enregistrés hors _id au maximum; champs numériques avec min/max/avg, dates avec min/max. Renouvelle l’activité. Vingt requêtes/minute, sous réserve du forfait."],
        prepareResource: ["No body. Returns 200 for a current copy or 202 for a new/shared job. Only a newly admitted job deducts preparation credits. A terminal failure without a result published by that job returns the actual debit to its original allowance period exactly once. Retries retain the charge; stopping polling does not fail the job. A failed refresh returns its own charge even if an older copy still serves. A successful empty table counts as success; later expiry or eviction does not return credits. This is an account-credit reversal, not a payment refund. Current copies, joins and polling cost zero but still count toward request limits. Keyed new jobs are capped at 20/account/hour; anonymous admission has a configured per-IP limit. A shared active-queue ceiling and format/size/row/column/storage caps also apply. A stale copy can continue serving during refresh. Paused admission returns 429 even for current copies. Anonymous requests from self-identified crawlers can read current copies and join shared jobs but cannot start new ones (429 AUTOMATED_CLIENT). Honour cooldown Retry-After; a new source version can bypass the old cooldown. No scheduled-refresh guarantee.",
            "Sans corps. Retourne 200 pour une copie actuelle ou 202 pour une tâche nouvelle/partagée. Seule une nouvelle admission déduit des crédits. Un échec définitif sans publication par cette tâche rend une seule fois le débit réel à sa période d’origine. Les réessais gardent le débit; arrêter le suivi ne fait pas échouer la tâche. Un renouvellement échoué rend son débit même si une ancienne copie reste disponible. Une table vide valide compte comme un succès; son expiration ultérieure ne rend pas les crédits. Aucun remboursement de paiement. Copie actuelle, tâche partagée et suivi : zéro crédit, mais comptent dans la fréquence. Maximum de 20 admissions/compte/heure avec clé; limite anonyme par IP configurée. La file commune et les plafonds de format, taille, lignes, colonnes et stockage s’appliquent. Une ancienne copie peut rester disponible. Une pause donne 429 même pour une copie actuelle. Sans clé, un robot d’indexation identifié peut lire une copie actuelle ou rejoindre une tâche partagée, mais pas en lancer une nouvelle (429 AUTOMATED_CLIENT). Respectez Retry-After; une nouvelle version peut contourner l’ancien délai. Aucune actualisation planifiée garantie."],
        ingestResourceLegacy: ["No body. Compatibility endpoint; new integrations should use /prepare for freshness and refresh. It returns an existing ready copy without refreshing stale data. Five requests/hour, plus shared limits. New-job charging matches /prepare.",
            "Sans corps. Compatibilité : utilisez /prepare pour gérer l’actualité et le renouvellement. Renvoie une copie prête sans actualiser une copie ancienne. Cinq requêtes/heure, plus les limites communes. Même coût d’admission que /prepare."],
        renewResourceActivity: ["No body. Renews an existing ready copy without preparing a file or recording popularity. A 409 means the copy is unavailable or replaced; re-read metadata. Zero credits still counts toward request limits.",
            "Sans corps. Renouvelle une copie prête, sans préparation ni popularité. Un 409 indique une copie absente ou remplacée : relisez les métadonnées. Zéro crédit compte toujours dans la fréquence."],
        getPreparationJob: ["Poll one request at a time with a bounded delay and honour Retry-After on errors. A done job is historical: re-read resource metadata before querying because a prepared copy may expire. Failure messages are sanitized; failure_reason and retry_at explain retry eligibility. Zero credits still counts toward request limits.",
            "Une requête de suivi à la fois, avec délai borné; respectez Retry-After en cas d’erreur. Une tâche done est historique : relisez les métadonnées, car une copie peut expirer. Messages assainis; failure_reason et retry_at décrivent le nouvel essai. Zéro crédit compte dans la fréquence."],
        getMapViewport: ["Enveloped WGS84 GeoJSON for admitted ArcGIS, local PostGIS or PMTiles maps. live=true identifies the viewport interface; it does not promise a publisher fetch on every call. Check returned/truncated; requests are capped at 1,000 features and 8 MiB. PMTiles viewport decoding also bounds tile count. Sixty viewport calls/minute plus plan request/concurrency limits.",
            "GeoJSON WGS84 enveloppé pour ArcGIS, PostGIS local ou PMTiles admis. live=true désigne l’interface, pas une lecture de l’éditeur à chaque appel. Consultez returned/truncated : 1 000 entités et 8 Mio maximum. Le décodage PMTiles limite aussi les tuiles. Soixante appels/minute, sous réserve du forfait."],
        getMapTile: ["PMTiles maps only. Copy the current tiles template/version and zoom range from resource metadata. Coordinates must fit the tile grid and archive zoom range. Anonymous successful tiles cache immutably for one year; keyed responses remain private, no-store. Up to 240 tiles/minute, also subject to the keyed plan request limit.",
            "Cartes PMTiles seulement. Utilisez le modèle tiles, la version et la plage de zoom des métadonnées. Les coordonnées doivent respecter la grille et l’archive. Cache anonyme immuable d’un an; réponses avec clé privées, no-store. Maximum de 240 tuiles/minute, et limite du forfait avec clé."],
        getComponentHealth: ["Public, unmetered and no-store. Sanitized host observations older than 180 seconds fail closed with HTTP 503. Independent components separate availability, preparation, maps, sources, commercial backlogs, backups and storage. Existing /ops semantics remain unchanged.",
            "Public, sans crédits et sans cache. Les observations de plus de 180 secondes donnent HTTP 503. Sépare disponibilité, préparation, cartes, sources, files commerciales, sauvegardes et stockage. Le comportement de /ops reste inchangé."]
    };
}

function cost(path, method) {
    return ['/healthz', '/readyz'].includes(path) || isPublicOperation({ path, method: method.toUpperCase() }) ? CREDIT_COSTS.activity
        : /\/(prepare|ingest)$/.test(path) ? `${CREDIT_COSTS.preparation} new job / ${CREDIT_COSTS.activity} existing`
            : /\/query$/.test(path) ? `${CREDIT_COSTS.query} row query / ${CREDIT_COSTS.aggregate} aggregation`
                : operationFor({ path, query: {} }).cost;
}

function openApi({ env, now }) {
    const enabled = env.COMMERCIAL_API_ENABLED === 'true';
    const cutoff = enabled && env.API_KEY_REQUIRED_AT && Number.isFinite(Date.parse(env.API_KEY_REQUIRED_AT)) ? env.API_KEY_REQUIRED_AT : null;
    const anonymous = !cutoff || now < Date.parse(cutoff);
    return {
        security: enabled ? (anonymous ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }]) : [{}],
        authentication: { accounts_enabled: enabled, anonymous_access: anonymous, api_key_required_at: cutoff },
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'CanQuery API key',
            description: enabled ? (anonymous ? SECURITY.anonymous : SECURITY.required) : SECURITY.disabled } },
        creditCosts: CREDIT_COSTS, workflowCosts: WORKFLOW_COSTS, limits: { keyed_preparations_per_account_hour: 20 },
        headers: HEADERS, headerFrench: HEADER_FRENCH, retryDescription: RETRY_DESCRIPTION,
        errors: ERRORS, defaultErrors: [401, 403, 429, 500, 503], rateLimitExample: { code: 'RATE_LIMIT', retry_after: 60 },
        errorCodes: ERROR_CODES, info: INFO, cost, costFrench: COST_FRENCH, descriptions
    };
}

module.exports = { openApi };
