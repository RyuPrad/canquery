export const PERFORMANCE_METHOD = 'web-vitals-v1';

/** Public website identity; no other tenant opts into this protocol or report. */
export function isCanQueryPerformanceWebsite(websiteId: string) {
  return (
    Boolean(process.env.CANQUERY_PERFORMANCE_WEBSITE_ID) &&
    websiteId === process.env.CANQUERY_PERFORMANCE_WEBSITE_ID
  );
}

export function isCanQueryPerformanceCollectionEnabled() {
  return process.env.CANQUERY_PERFORMANCE_COLLECTION_ENABLED !== 'false';
}
