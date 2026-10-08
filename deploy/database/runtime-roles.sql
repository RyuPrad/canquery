-- Explicit administrative apply, never invoked by application migration/startup.
-- psql --no-psqlrc --set=ON_ERROR_STOP=1 --set=app_database=... --set=deploy_role=... --file=runtime-roles.sql
-- Database/roles are cluster identities. Run only on the reviewed application DB
-- with runtime services stopped and the dedicated role names unused elsewhere.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('canquery.provision_database', :'app_database', true),
       set_config('canquery.provision_owner', :'deploy_role', true);
DO $$
DECLARE owner_name text := current_setting('canquery.provision_owner');
BEGIN
    IF current_database() <> current_setting('canquery.provision_database')
        OR owner_name IN ('canquery_api','canquery_ingest','canquery_map','canquery_store_owner')
        OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = owner_name) THEN
        RAISE EXCEPTION 'Database/deployment owner guard failed';
    END IF;
    IF NOT EXISTS (SELECT FROM public.schema_migrations WHERE filename = '036_runtime_access_helpers.sql') THEN
        RAISE EXCEPTION 'Apply migration 036 as the deployment owner first';
    END IF;
    IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('canquery_lock_public_resource',
        'canquery_lock_resource_publication','canquery_lock_pins') AND p.proowner <> owner_name::regrole) THEN
        RAISE EXCEPTION 'Lock helpers must be owned by the deployment owner';
    END IF;
    IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'store' AND c.relkind = 'r'
        AND (c.relname !~ '^r_[0-9a-f_]+$' OR pg_get_userbyid(c.relowner) NOT IN
        (owner_name,'canquery_ingest','canquery_store_owner'))) THEN
        RAISE EXCEPTION 'Unexpected store table or owner; review inventory before transfer';
    END IF;
END;
$$;
DO $$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['canquery_api','canquery_ingest','canquery_map','canquery_store_owner'] LOOP
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('CREATE ROLE %I', role_name);
        END IF;
        -- Refuse inherited privileges rather than silently broadening/revoking
        -- memberships from a pre-existing cluster role used for another purpose.
        IF EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
            WHERE m.member=role_name::regrole AND r.rolname <> 'canquery_store_owner') THEN
            RAISE EXCEPTION 'Unexpected runtime role membership: %', role_name;
        END IF;
        IF role_name IN ('canquery_api','canquery_map') AND EXISTS
            (SELECT FROM pg_auth_members WHERE member=role_name::regrole) THEN
            RAISE EXCEPTION 'API/map roles must have no memberships';
        END IF;
        EXECUTE format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', role_name);
        EXECUTE format('ALTER ROLE %I SET search_path = public', role_name);
    END LOOP;
END;
$$;
ALTER ROLE canquery_api LOGIN;
ALTER ROLE canquery_ingest LOGIN;
ALTER ROLE canquery_map LOGIN;
ALTER ROLE canquery_store_owner NOLOGIN;
GRANT canquery_store_owner TO canquery_ingest WITH INHERIT TRUE, SET TRUE;
GRANT canquery_store_owner TO :"deploy_role" WITH INHERIT TRUE, SET TRUE;
REVOKE CREATE, TEMPORARY ON DATABASE :"app_database" FROM PUBLIC;
REVOKE ALL ON DATABASE :"app_database" FROM canquery_api, canquery_ingest, canquery_map, canquery_store_owner;
GRANT CONNECT ON DATABASE :"app_database" TO canquery_api, canquery_ingest, canquery_map;
GRANT TEMPORARY ON DATABASE :"app_database" TO canquery_map;
REVOKE CREATE ON SCHEMA public, store, map_store, commercial, canquery_auth FROM PUBLIC;
REVOKE ALL ON SCHEMA public, store, map_store, commercial, canquery_auth
    FROM canquery_api, canquery_ingest, canquery_map, canquery_store_owner;
GRANT USAGE ON SCHEMA public TO canquery_api, canquery_ingest, canquery_map;
GRANT USAGE ON SCHEMA commercial TO canquery_api, canquery_ingest;
GRANT USAGE ON SCHEMA canquery_auth TO canquery_api;
GRANT USAGE ON SCHEMA store TO canquery_api;
GRANT USAGE, CREATE ON SCHEMA store TO canquery_store_owner;
GRANT USAGE ON SCHEMA map_store TO canquery_api, canquery_map;
REVOKE ALL ON ALL TABLES IN SCHEMA public, store, map_store, commercial, canquery_auth
    FROM canquery_api, canquery_ingest, canquery_map;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, store, map_store, commercial, canquery_auth
    FROM canquery_api, canquery_ingest, canquery_map;
GRANT SELECT ON public.resources, public.datasets, public.organizations, public.dataset_sources,
    public.catalog_sources, public.dataset_places, public.places, public.place_aliases,
    public.place_identifiers, public.ingested_resources, public.ingest_jobs, public.resource_maps
    TO canquery_api, canquery_ingest, canquery_map;
GRANT SELECT ON public.query_log, public.top_downloads, public.sync_runs, public.ingest_runs,
    public.map_index_jobs, public.pinned_resources, public.retired_ingest_tables TO canquery_api;
GRANT SELECT ON ALL TABLES IN SCHEMA store TO canquery_api;
GRANT SELECT ON map_store.features TO canquery_api;
GRANT INSERT, UPDATE ON public.ingest_jobs TO canquery_api;
GRANT UPDATE(last_accessed_at) ON public.ingested_resources TO canquery_api;
GRANT INSERT ON public.query_log TO canquery_api;
GRANT USAGE ON SEQUENCE public.ingest_jobs_id_seq, public.query_log_id_seq TO canquery_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA canquery_auth TO canquery_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.accounts, commercial.api_keys, commercial.mail_outbox,
    commercial.periods, commercial.preparation_charges, commercial.rate_windows, commercial.requests,
    commercial.stripe_events, commercial.usage_daily TO canquery_api;
GRANT SELECT, INSERT ON commercial.environment TO canquery_api;
GRANT EXECUTE ON FUNCTION public.canquery_lock_public_resource(text) TO canquery_api;
GRANT UPDATE ON public.ingest_jobs TO canquery_ingest;
GRANT SELECT, INSERT, UPDATE ON public.ingest_runs TO canquery_ingest;
GRANT USAGE ON SEQUENCE public.ingest_runs_id_seq TO canquery_ingest;
GRANT INSERT, UPDATE, DELETE ON public.ingested_resources TO canquery_ingest;
GRANT SELECT, INSERT, DELETE ON public.retired_ingest_tables TO canquery_ingest;
GRANT SELECT ON public.pinned_resources TO canquery_ingest;
GRANT SELECT ON commercial.preparation_charges TO canquery_ingest;
GRANT UPDATE(outcome, resolved_at, reversal_reason) ON commercial.preparation_charges TO canquery_ingest;
GRANT SELECT(id, account_id, used), UPDATE(used) ON commercial.periods TO canquery_ingest;
GRANT SELECT(id, account_id, period_id, job_id, credits, state), UPDATE(state, finished_at)
    ON commercial.requests TO canquery_ingest;
GRANT EXECUTE ON FUNCTION public.canquery_lock_resource_publication(text), public.canquery_lock_pins()
    TO canquery_ingest;
GRANT SELECT, UPDATE ON public.map_index_jobs TO canquery_map;
GRANT INSERT, UPDATE, DELETE ON public.resource_maps TO canquery_map;
GRANT SELECT, INSERT, DELETE ON map_store.features TO canquery_map;
GRANT SELECT ON public.spatial_ref_sys TO canquery_api, canquery_map;
-- ALTER TABLE OWNER also transfers its owned serial sequences. Leave schemas,
-- catalogue objects, and financial rows owned by the deployment identity.
DO $$
DECLARE item record;
BEGIN
    FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='store' AND c.relkind='r' LOOP
        EXECUTE format('ALTER TABLE store.%I OWNER TO canquery_store_owner', item.relname);
    END LOOP;
END;
$$;
-- Default ACLs belong to the actual CREATE role, not its inherited owner role.
ALTER DEFAULT PRIVILEGES FOR ROLE :"deploy_role" IN SCHEMA store GRANT SELECT ON TABLES TO canquery_api;
ALTER DEFAULT PRIVILEGES FOR ROLE canquery_ingest IN SCHEMA store GRANT SELECT ON TABLES TO canquery_api;
ALTER DEFAULT PRIVILEGES FOR ROLE canquery_store_owner IN SCHEMA store GRANT SELECT ON TABLES TO canquery_api;
COMMIT;
