-- Nullable fields preserve existing tenants and immutable historical samples.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "website_event"
  ADD COLUMN "performance_method" VARCHAR(32),
  ADD COLUMN "performance_revision" INTEGER,
  ADD COLUMN "performance_navigation_type" VARCHAR(32);

ALTER TABLE "website_event" ADD CONSTRAINT "website_event_performance_revision_check"
  CHECK ("performance_revision" IS NULL OR "performance_revision" > 0);

COMMIT;
