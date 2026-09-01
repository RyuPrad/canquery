CREATE TABLE IF NOT EXISTS search_console_query_pages (
    data_date date NOT NULL,
    search_type text NOT NULL,
    query_text text NOT NULL CHECK (query_text <> ''),
    page_url text NOT NULL CHECK (page_url <> ''),
    clicks double precision NOT NULL DEFAULT 0,
    impressions double precision NOT NULL DEFAULT 0,
    ctr double precision NOT NULL DEFAULT 0,
    position double precision NOT NULL DEFAULT 0,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (data_date, search_type, query_text, page_url)
);

CREATE INDEX IF NOT EXISTS idx_search_console_query_pages_type_date
    ON search_console_query_pages(search_type, data_date DESC);
CREATE INDEX IF NOT EXISTS idx_search_console_query_pages_page_date
    ON search_console_query_pages(page_url, data_date DESC);
