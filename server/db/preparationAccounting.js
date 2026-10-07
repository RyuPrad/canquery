const pool = require('./pool');
const { transaction, meterLock } = require('./commercialQueries');
const { INGEST_RESOURCE_LOCK_NAMESPACE } = require('./ingestResourceLock');

// Caller holds the resource lock and owns/has locked the job. Keep this ordering
// everywhere: resource -> job -> commercial meter -> charge/period. Never take a
// resource lock from ordinary request maintenance while holding the meter lock.
async function settlePreparationOn(client, jobId) {
    const job = (await client.query('SELECT * FROM ingest_jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
    if (!job) return { outcome: 'missing_job', changed: false };
    const succeeded = Boolean(job.published_at) || job.status === 'done';
    if (!succeeded && job.status !== 'failed') return { outcome: 'pending', changed: false };
    await meterLock(client);
    const charge = (await client.query('SELECT * FROM commercial.preparation_charges WHERE job_id=$1 FOR UPDATE', [jobId])).rows[0];
    if (!charge) return { outcome: 'uncharged', changed: false };
    if (charge.outcome !== 'pending') return { outcome: charge.outcome, changed: false };
    const outcome = succeeded ? 'succeeded' : 'refunded';
    if (!succeeded) {
        const result = await client.query(`UPDATE commercial.periods SET used=used-$3
            WHERE id=$1 AND account_id=$2 AND used >= $3 RETURNING id`, [charge.period_id, charge.account_id, charge.credits]);
        if (result.rowCount !== 1) throw new Error('Preparation debit does not reconcile with its original allowance period');
        // The request may already have expired. Its disappearance never erases
        // the durable debit, and cannot prevent a valid original-period refund.
        await client.query(`UPDATE commercial.requests SET state='refunded',finished_at=now()
            WHERE id=$1 AND account_id=$2 AND period_id=$3 AND job_id=$4 AND credits=$5 AND state='charged'`,
        [charge.request_id,charge.account_id,charge.period_id,charge.job_id,charge.credits]);
    }
    await client.query(`UPDATE commercial.preparation_charges SET outcome=$2,resolved_at=now(),
        reversal_reason=CASE WHEN $2='refunded' THEN 'terminal_failure' ELSE NULL END WHERE request_id=$1`, [charge.request_id,outcome]);
    return { outcome, changed: true };
}

async function lockJobForReconciliation(client, candidate) {
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1,hashtext($2)) AS acquired', [INGEST_RESOURCE_LOCK_NAMESPACE,candidate.resource_id]);
    if (!lock.rows[0].acquired) return null;
    return (await client.query('SELECT * FROM ingest_jobs WHERE id=$1 AND resource_id=$2 FOR UPDATE SKIP LOCKED', [candidate.job_id,candidate.resource_id])).rows[0] || null;
}

// This handles interrupted final accounting only. A client timeout, old heartbeat
// or abandoned polling never establishes failure; worker-owned recovery decides.
async function reconcilePreparations(db = pool, batch = 100) {
    const limit = Math.min(100,Math.max(1,Number.isSafeInteger(batch) ? batch : 100));
    const candidates = (await db.query(`SELECT c.job_id,j.resource_id FROM commercial.preparation_charges c
        JOIN ingest_jobs j ON j.id=c.job_id WHERE c.outcome='pending'
        AND (j.status IN ('done','failed') OR j.published_at IS NOT NULL)
        ORDER BY c.charged_at,c.job_id LIMIT $1`, [limit])).rows;
    const result = { examined:candidates.length, resolved:0, skipped:0, errors:0 };
    for (const candidate of candidates) {
        try {
            const settled = await transaction(async client => {
                if (!await lockJobForReconciliation(client,candidate)) return null;
                return settlePreparationOn(client,candidate.job_id);
            },db);
            if (settled?.changed) result.resolved++;
            else result.skipped++;
        } catch { result.errors++; }
    }
    if (result.errors) console.error('Preparation accounting reconciliation failed for a bounded batch; original debits retained');
    return result;
}

async function adoptionCandidate(client, job) {
    const requests = (await client.query(`SELECT r.id,r.account_id,r.period_id,r.credits,r.created_at,
        r.state,p.account_id AS period_account_id,p.used AS period_used FROM commercial.requests r
        LEFT JOIN commercial.periods p ON p.id=r.period_id
        WHERE r.job_id=$1 AND r.operation='preparation' ORDER BY r.created_at,r.id`, [job.id])).rows;
    const prior = (await client.query('SELECT request_id FROM commercial.preparation_charges WHERE job_id=$1', [job.id])).rows[0];
    const debit = requests.length === 1 ? requests[0] : null;
    // Pre-receipt workers could publish and crash before finishing the job. A
    // retained debit proves payment, not absence of that successful publication.
    // Only never-claimed pending jobs are safe to adopt automatically.
    const unattempted = job.status === 'pending' && job.attempts === 0 && !job.claimed_at && !job.published_at;
    const eligible = !prior && unattempted && debit?.state === 'charged'
        && debit.credits > 0 && debit.account_id === debit.period_account_id && Number(debit.period_used) >= debit.credits;
    return { job_id:job.id,resource_id:job.resource_id,status:job.status,attempts:job.attempts,request_id:debit?.id || null,
        eligible:Boolean(eligible),reason:prior ? 'already_recorded' : !unattempted ? 'publication_uncertain' : eligible ? null : 'unverified_original_debit',debit };
}

// Cutover is an explicit administrative action after admission is frozen and the
// old worker has stopped. Only never-claimed pending jobs can be adopted.
// Apply accepts exact previewed request/job pairs; it
// never invents a debit or adopts a historical terminal job.
async function adoptActivePreparations(db = pool, { apply=false, candidates=[] } = {}) {
    if (apply && (!Array.isArray(candidates) || candidates.length > 100 || candidates.some(c =>
        !/^[1-9][0-9]*$/.test(String(c.job_id)) || !/^[0-9a-f-]{36}$/i.test(c.request_id || '')))) {
        throw new Error('Use at most 100 reviewed job and original request pairs');
    }
    if (!apply) {
        const jobs = (await db.query(`SELECT id,resource_id,status,attempts,claimed_at,published_at FROM ingest_jobs
            WHERE status IN ('pending','running') ORDER BY id LIMIT 100`)).rows;
        const rows = [];
        for (const job of jobs) {
            const candidate = await adoptionCandidate(db,job);
            delete candidate.debit;
            rows.push(candidate);
        }
        return { preview:true,candidates:rows };
    }
    const adopted = [];
    for (const reviewed of candidates) {
        const result = await transaction(async client => {
            const existing = (await client.query('SELECT id AS job_id,resource_id FROM ingest_jobs WHERE id=$1', [reviewed.job_id])).rows[0];
            if (!existing) throw new Error('Reviewed preparation job no longer exists');
            const job = await lockJobForReconciliation(client,existing);
            if (!job) throw new Error('Reviewed preparation job is busy');
            await meterLock(client);
            const current = await adoptionCandidate(client,job);
            if (!current.eligible || current.request_id !== reviewed.request_id) throw new Error('Reviewed preparation debit or active job changed');
            const debit = current.debit;
            await client.query(`INSERT INTO commercial.preparation_charges(request_id,job_id,account_id,period_id,credits,charged_at)
                VALUES ($1,$2,$3,$4,$5,$6)`, [debit.id,job.id,debit.account_id,debit.period_id,debit.credits,debit.created_at]);
            return { job_id:job.id,request_id:debit.id };
        },db);
        adopted.push(result);
    }
    return { preview:false,adopted };
}

module.exports = { settlePreparationOn, reconcilePreparations, adoptActivePreparations };
