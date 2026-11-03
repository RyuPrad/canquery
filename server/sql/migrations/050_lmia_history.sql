-- Every quarter of the federal positive LMIA employers list (open.canada.ca dataset
-- 90fed587-1364-4f33-a9ee-208181dc0b97), read from its English files by the deployment
-- owner's build-lmia-history job (server/services/lmiaHistory.js): one row per file in
-- lmia_files, one row per employer line of a file in lmia_positive_rows, and
-- lmia_employers, one row per employer key, which the job refreshes after a load.
-- canquery_api only reads them (deploy/database/runtime-roles.sql); nothing else writes.
-- The /lmia pages search employer keys with trigram indexes, so pg_trgm (a trusted
-- contrib extension) is created here.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A file's period comes from its catalogue name (2026Q2-…, 2017Q1Q2-…, 2016-…):
-- period_key is the year and last month (202606). source_version is the resource
-- version (services/resourceVersion.js) whose rows are loaded; a failed attempt
-- leaves the loaded rows and records what failed.
CREATE TABLE public.lmia_files (
    resource_id text PRIMARY KEY,
    period_key integer NOT NULL UNIQUE CHECK (period_key BETWEEN 190001 AND 299912),
    period_kind text NOT NULL CHECK (period_kind IN ('quarter', 'half', 'year')),
    period_start date NOT NULL,
    period_end date NOT NULL CHECK (period_end >= period_start),
    source_version text,
    loaded_at timestamptz,
    row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    employers integer NOT NULL DEFAULT 0 CHECK (employers >= 0),
    positions integer NOT NULL DEFAULT 0 CHECK (positions >= 0),
    lmias integer CHECK (lmias >= 0),
    noc_version smallint CHECK (noc_version IN (2011, 2021)),
    failure text CHECK (failure ~ '^[a-z_]{1,40}$'),
    failed_version text,
    failed_at timestamptz,
    CHECK ((source_version IS NULL) = (loaded_at IS NULL)),
    CHECK ((failure IS NULL) = (failed_at IS NULL))
);

-- One employer line of a file, with the grouped columns of older files filled
-- down. province is a code (HO: head office outside Canada); occupation_code is a
-- NOC 2011 (4 digits) or NOC 2021 (5 digits) code.
CREATE TABLE public.lmia_positive_rows (
    resource_id text NOT NULL REFERENCES public.lmia_files(resource_id) ON DELETE CASCADE,
    line integer NOT NULL CHECK (line > 0),
    period_key integer NOT NULL CHECK (period_key BETWEEN 190001 AND 299912),
    province text CHECK (province IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT', 'HO')),
    stream text CHECK (char_length(stream) BETWEEN 1 AND 80),
    employer text NOT NULL CHECK (char_length(employer) BETWEEN 1 AND 300),
    employer_key text NOT NULL CHECK (employer_key ~ '^[a-z0-9]+( [a-z0-9]+)*$' AND char_length(employer_key) <= 200),
    address text CHECK (char_length(address) BETWEEN 1 AND 300),
    city text CHECK (char_length(city) BETWEEN 1 AND 120),
    occupation_code text CHECK (occupation_code ~ '^[0-9]{4,5}$'),
    occupation_title text CHECK (char_length(occupation_title) BETWEEN 1 AND 300),
    noc_version smallint CHECK (noc_version IN (2011, 2021)),
    incorporation text CHECK (char_length(incorporation) BETWEEN 1 AND 80),
    approved_lmias integer CHECK (approved_lmias >= 0),
    approved_positions integer NOT NULL CHECK (approved_positions >= 0),
    PRIMARY KEY (resource_id, line),
    CHECK ((occupation_code IS NULL) = (noc_version IS NULL))
);
CREATE INDEX lmia_positive_rows_employer ON public.lmia_positive_rows (employer_key, period_key);
CREATE INDEX lmia_positive_rows_period ON public.lmia_positive_rows (period_key, province);
CREATE INDEX lmia_positive_rows_occupation ON public.lmia_positive_rows (occupation_code, period_key);

-- One row per employer key across every loaded file: the newest spelling, city and
-- province, every province and occupation code, the first and last periods, and
-- positions overall and in the employer's last period.
CREATE MATERIALIZED VIEW public.lmia_employers AS
SELECT r.employer_key,
    (array_agg(r.employer ORDER BY r.period_key DESC, r.line))[1] AS employer,
    (array_agg(r.province ORDER BY r.period_key DESC, r.line))[1] AS province,
    (array_agg(r.city ORDER BY r.period_key DESC, r.line) FILTER (WHERE r.city IS NOT NULL))[1] AS city,
    array_agg(DISTINCT r.province ORDER BY r.province) FILTER (WHERE r.province IS NOT NULL) AS provinces,
    array_agg(DISTINCT r.occupation_code ORDER BY r.occupation_code) FILTER (WHERE r.occupation_code IS NOT NULL) AS occupations,
    min(r.period_key) AS first_period,
    max(r.period_key) AS last_period,
    count(DISTINCT r.period_key)::integer AS periods,
    sum(r.approved_positions)::integer AS positions,
    (sum(r.approved_positions) FILTER (WHERE r.period_key = last.period_key))::integer AS last_positions
FROM public.lmia_positive_rows r
JOIN (SELECT employer_key, max(period_key) AS period_key FROM public.lmia_positive_rows GROUP BY employer_key) last
    USING (employer_key)
GROUP BY r.employer_key;
CREATE UNIQUE INDEX lmia_employers_key ON public.lmia_employers (employer_key);
CREATE INDEX lmia_employers_key_trgm ON public.lmia_employers USING gin (employer_key gin_trgm_ops);
CREATE INDEX lmia_employers_recent ON public.lmia_employers (last_period DESC, last_positions DESC, employer_key);
CREATE INDEX lmia_employers_provinces ON public.lmia_employers USING gin (provinces);
CREATE INDEX lmia_employers_occupations ON public.lmia_employers USING gin (occupations);
