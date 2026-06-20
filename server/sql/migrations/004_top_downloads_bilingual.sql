-- Per-language representatives for the Top 100 leaderboard. A dataset published as
-- separate English + French files now charts the language-appropriate one, so an
-- English-mode visitor sees English columns/values and a French-mode visitor sees
-- French. resource_id stays as the primary/default (= COALESCE(en, fr)) for any
-- lang-unaware reader; the seed populates all three on its next run.
ALTER TABLE top_downloads ADD COLUMN IF NOT EXISTS resource_id_en text;
ALTER TABLE top_downloads ADD COLUMN IF NOT EXISTS resource_id_fr text;
