CREATE TABLE IF NOT EXISTS search_console_daily (
    data_date date NOT NULL,
    search_type text NOT NULL,
    clicks double precision NOT NULL DEFAULT 0,
    impressions double precision NOT NULL DEFAULT 0,
    ctr double precision NOT NULL DEFAULT 0,
    position double precision NOT NULL DEFAULT 0,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (data_date, search_type)
);

CREATE TABLE IF NOT EXISTS search_console_breakdowns (
    data_date date NOT NULL,
    search_type text NOT NULL,
    dimension text NOT NULL CHECK (dimension IN ('query', 'page', 'country', 'device')),
    value text NOT NULL,
    clicks double precision NOT NULL DEFAULT 0,
    impressions double precision NOT NULL DEFAULT 0,
    ctr double precision NOT NULL DEFAULT 0,
    position double precision NOT NULL DEFAULT 0,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (data_date, search_type, dimension, value)
);

CREATE INDEX IF NOT EXISTS idx_search_console_daily_type_date
    ON search_console_daily(search_type, data_date DESC);
CREATE INDEX IF NOT EXISTS idx_search_console_breakdowns_dimension_date
    ON search_console_breakdowns(dimension, data_date DESC);
CREATE INDEX IF NOT EXISTS idx_search_console_breakdowns_clicks
    ON search_console_breakdowns(dimension, clicks DESC);
