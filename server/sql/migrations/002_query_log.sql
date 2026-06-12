CREATE TABLE IF NOT EXISTS query_log (
    id bigserial PRIMARY KEY,
    resource_id text NOT NULL,
    query_mode text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_log_created_at ON query_log(created_at);
