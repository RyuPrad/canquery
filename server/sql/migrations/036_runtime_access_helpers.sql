-- Row locks require UPDATE privileges in PostgreSQL. These narrow owner-defined
-- operations preserve lock semantics without giving runtime roles catalogue DML.
-- Role provisioning/grants are a separate reviewed administrative step.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE FUNCTION public.canquery_lock_public_resource(resource_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM r.id FROM public.resources r JOIN public.datasets d ON d.id = r.dataset_id
        WHERE r.id = resource_id FOR KEY SHARE OF r, d;
    RETURN FOUND;
END;
$$;
CREATE FUNCTION public.canquery_lock_resource_publication(resource_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM r.id FROM public.resources r WHERE r.id = resource_id FOR SHARE;
    RETURN FOUND;
END;
$$;
CREATE FUNCTION public.canquery_lock_pins()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    LOCK TABLE public.pinned_resources IN SHARE MODE;
END;
$$;
REVOKE ALL ON FUNCTION public.canquery_lock_public_resource(text),
    public.canquery_lock_resource_publication(text), public.canquery_lock_pins() FROM PUBLIC;
