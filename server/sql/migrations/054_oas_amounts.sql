-- The quarterly tables of Guaranteed Income Supplement and Allowance amounts by income
-- (open.canada.ca dataset dfa4daf1-669e-4514-82cd-982f27707ed0, "Old Age Security (OAS) -
-- Table of Benefit Amounts by marital status and income level"), read from its five CSV
-- files by the deployment owner's load-oas-amounts job (server/services/oasAmounts.js).
-- The publisher replaces the files in place every quarter; each quarter that was loaded
-- stays here. Money is whole cents, read from the file's text, so no amount ever passes
-- through a float. canquery_api only reads (deploy/database/runtime-roles.sql); nothing
-- else writes.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- One loaded table of one quarter. period_key is the benefit year and the quarter's last
-- month (202612 for October to December 2026), as lmia_files does. source_version is the
-- resource version (services/resourceVersion.js) whose rows are loaded and content_sha256
-- a digest of those rows: a file published again with the same rows keeps its loaded_at.
CREATE TABLE public.oas_files (
    period_key integer NOT NULL CHECK (period_key BETWEEN 190003 AND 299912),
    table_no smallint NOT NULL CHECK (table_no BETWEEN 1 AND 5),
    benefit_year smallint NOT NULL,
    benefit_quarter smallint NOT NULL CHECK (benefit_quarter BETWEEN 1 AND 4),
    income_year smallint NOT NULL,
    resource_id text NOT NULL CHECK (char_length(resource_id) BETWEEN 1 AND 200),
    source_version text NOT NULL,
    content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    row_count integer NOT NULL CHECK (row_count > 0),
    loaded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (period_key, table_no),
    CHECK (period_key = benefit_year * 100 + benefit_quarter * 3),
    CHECK (income_year BETWEEN benefit_year - 3 AND benefit_year)
);

-- One income band of a table, in the file's order. amount_cents is the table's own
-- monthly benefit: the Guaranteed Income Supplement in tables 1 to 4, the Allowance for
-- the Survivor in table 5. allowance_cents is the partner's Allowance (table 4 only).
-- The two with-OAS columns are the publisher's combined OAS pension and GIS amounts for
-- ages 65 to 74 and 75 and over (tables 1 to 4), kept exactly as published.
CREATE TABLE public.oas_rows (
    period_key integer NOT NULL,
    table_no smallint NOT NULL,
    line integer NOT NULL CHECK (line > 0),
    income_from_cents integer NOT NULL CHECK (income_from_cents >= 0),
    income_to_cents integer NOT NULL CHECK (income_to_cents >= income_from_cents),
    amount_cents integer NOT NULL CHECK (amount_cents >= 0),
    allowance_cents integer CHECK (allowance_cents >= 0),
    with_oas_65_cents integer CHECK (with_oas_65_cents >= amount_cents),
    with_oas_75_cents integer CHECK (with_oas_75_cents >= amount_cents),
    PRIMARY KEY (period_key, table_no, line),
    FOREIGN KEY (period_key, table_no) REFERENCES public.oas_files (period_key, table_no) ON DELETE CASCADE,
    CHECK ((table_no = 4) = (allowance_cents IS NOT NULL)),
    CHECK ((table_no <= 4) = (with_oas_65_cents IS NOT NULL)),
    CHECK ((table_no <= 4) = (with_oas_75_cents IS NOT NULL))
);

-- The quarters that can be shown: all five tables of the period are loaded and agree on
-- the income year. A quarter the publisher has replaced only in part is not listed, so
-- the pages never show tables of two quarters side by side.
CREATE VIEW public.oas_periods AS
SELECT period_key, min(benefit_year) AS benefit_year, min(benefit_quarter) AS benefit_quarter,
    min(income_year) AS income_year, max(loaded_at) AS loaded_at
FROM public.oas_files
GROUP BY period_key
HAVING count(*) = 5 AND min(income_year) = max(income_year);
