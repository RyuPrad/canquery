-- Preserve a preparation debit beyond the short-lived HTTP request log.
-- No historical jobs are adopted automatically; the guarded admin preview/apply
-- flow admits only individually reviewed, still-active original debits.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE ingest_jobs
    ADD COLUMN published_table_name text,
    ADD COLUMN published_source_version text,
    ADD COLUMN published_at timestamptz,
    ADD CONSTRAINT ingest_jobs_publication_receipt CHECK (
        (published_table_name IS NULL AND published_source_version IS NULL AND published_at IS NULL)
        OR (published_table_name IS NOT NULL AND published_source_version IS NOT NULL AND published_at IS NOT NULL)
    );
CREATE TABLE commercial.preparation_charges (
    request_id uuid PRIMARY KEY,
    -- Deliberately no request/job FK: HTTP details expire and catalogue recovery
    -- may remove a job. Neither is permission to lose the original debit.
    job_id bigint NOT NULL UNIQUE,
    account_id uuid NOT NULL REFERENCES commercial.accounts(id),
    period_id text NOT NULL REFERENCES commercial.periods(id),
    credits integer NOT NULL CHECK (credits > 0),
    charged_at timestamptz NOT NULL,
    outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','succeeded','refunded')),
    resolved_at timestamptz,
    reversal_reason text CHECK (reversal_reason = 'terminal_failure'),
    CHECK ((outcome = 'pending' AND resolved_at IS NULL AND reversal_reason IS NULL)
        OR (outcome = 'succeeded' AND resolved_at IS NOT NULL AND reversal_reason IS NULL)
        OR (outcome = 'refunded' AND resolved_at IS NOT NULL AND reversal_reason = 'terminal_failure'))
);
CREATE INDEX commercial_preparation_unresolved ON commercial.preparation_charges(charged_at,job_id) WHERE outcome='pending';
CREATE INDEX commercial_preparation_account ON commercial.preparation_charges(account_id,charged_at DESC);
-- A reversal changes the disposition, never the original debit or payer.
CREATE FUNCTION commercial.protect_preparation_debit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.request_id,NEW.job_id,NEW.account_id,NEW.period_id,NEW.credits,NEW.charged_at)
        IS DISTINCT FROM (OLD.request_id,OLD.job_id,OLD.account_id,OLD.period_id,OLD.credits,OLD.charged_at)
        OR (OLD.outcome <> 'pending' AND (NEW.outcome,NEW.resolved_at,NEW.reversal_reason)
            IS DISTINCT FROM (OLD.outcome,OLD.resolved_at,OLD.reversal_reason)) THEN
        RAISE EXCEPTION 'Preparation debit and resolved outcome are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_preparation_debit BEFORE UPDATE ON commercial.preparation_charges
    FOR EACH ROW EXECUTE FUNCTION commercial.protect_preparation_debit();
