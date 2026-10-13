-- Hosted-edition grants on the auth and commercial schemas. Apply immediately
-- after deploy/database/runtime-roles.sql, in the same reviewed window and with
-- the same database variable; together they give the hosted runtime grants.
-- psql --no-psqlrc --set=ON_ERROR_STOP=1 --set=app_database=... --file=server/enterprise/database/runtime-roles.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('canquery.provision_database', :'app_database', true);
DO $$
BEGIN
    IF current_database() <> current_setting('canquery.provision_database')
        OR (SELECT count(*) FROM pg_roles WHERE rolname IN
            ('canquery_api','canquery_ingest','canquery_map','canquery_store_owner')) <> 4 THEN
        RAISE EXCEPTION 'Apply deploy/database/runtime-roles.sql to this database first';
    END IF;
END;
$$;
REVOKE CREATE ON SCHEMA commercial, canquery_auth FROM PUBLIC;
REVOKE ALL ON SCHEMA commercial, canquery_auth
    FROM canquery_api, canquery_ingest, canquery_map, canquery_store_owner;
GRANT USAGE ON SCHEMA commercial TO canquery_api, canquery_ingest;
GRANT USAGE ON SCHEMA canquery_auth TO canquery_api;
REVOKE ALL ON ALL TABLES IN SCHEMA commercial, canquery_auth
    FROM canquery_api, canquery_ingest, canquery_map;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA commercial, canquery_auth
    FROM canquery_api, canquery_ingest, canquery_map;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA canquery_auth TO canquery_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.accounts, commercial.api_keys, commercial.mail_outbox,
    commercial.periods, commercial.preparation_charges, commercial.rate_windows, commercial.requests,
    commercial.stripe_events, commercial.usage_daily TO canquery_api;
GRANT SELECT, INSERT ON commercial.environment TO canquery_api;
GRANT SELECT ON commercial.preparation_charges TO canquery_ingest;
GRANT UPDATE(outcome, resolved_at, reversal_reason) ON commercial.preparation_charges TO canquery_ingest;
GRANT SELECT(id, account_id, used), UPDATE(used) ON commercial.periods TO canquery_ingest;
GRANT SELECT(id, account_id, period_id, job_id, credits, state), UPDATE(state, finished_at)
    ON commercial.requests TO canquery_ingest;
COMMIT;
