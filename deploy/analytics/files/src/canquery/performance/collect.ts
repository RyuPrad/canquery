import { z } from 'zod';
import { PERFORMANCE_METHOD } from './config';

export const performanceUpdateSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().min(1).max(2147483647),
    method: z.literal(PERFORMANCE_METHOD),
    navigationType: z.enum([
      'navigate',
      'reload',
      'back-forward',
      'back-forward-cache',
      'prerender',
      'restore',
    ]),
  })
  .strict();

export type PerformanceUpdate = z.infer<typeof performanceUpdateSchema>;

// Full snapshots, rather than metric deltas, allow a newer request to arrive first.
// A newer INP can legitimately decrease as the interaction population grows.
export const UPSERT_PERFORMANCE_SQL = `
INSERT INTO website_event (
  event_id, website_id, session_id, visit_id, created_at, event_type,
  url_path, page_title, hostname, lcp, inp, cls, fcp, ttfb,
  performance_method, performance_revision, performance_navigation_type
) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, 5,
  $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (event_id) DO UPDATE SET
  lcp = COALESCE(EXCLUDED.lcp, website_event.lcp),
  inp = COALESCE(EXCLUDED.inp, website_event.inp),
  cls = COALESCE(EXCLUDED.cls, website_event.cls),
  fcp = COALESCE(EXCLUDED.fcp, website_event.fcp),
  ttfb = COALESCE(EXCLUDED.ttfb, website_event.ttfb),
  performance_revision = EXCLUDED.performance_revision
WHERE website_event.website_id = EXCLUDED.website_id
  AND website_event.event_type = 5
  AND website_event.performance_method = EXCLUDED.performance_method
  AND website_event.url_path = EXCLUDED.url_path
  AND website_event.performance_navigation_type = EXCLUDED.performance_navigation_type
  AND website_event.performance_revision < EXCLUDED.performance_revision
`;
