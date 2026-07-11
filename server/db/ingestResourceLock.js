// Resource-scoped transaction advisory locks serialize anonymous enqueue checks
// with a worker's terminal job transition. The fixed first key namespaces these
// locks away from the worker/store process locks; hash collisions only serialize
// two unrelated resources and cannot weaken correctness.
const INGEST_RESOURCE_LOCK_NAMESPACE = 1667329650;

function lockIngestResource(db, resourceId) {
    return db.query(
        'SELECT pg_advisory_xact_lock($1, hashtext($2))',
        [INGEST_RESOURCE_LOCK_NAMESPACE, String(resourceId)]
    );
}

module.exports = { INGEST_RESOURCE_LOCK_NAMESPACE, lockIngestResource };
