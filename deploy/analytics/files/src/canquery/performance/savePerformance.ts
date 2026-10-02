import { FIELD_LENGTH } from '@/lib/constants';
import { uuid } from '@/lib/crypto';
import { truncateString } from '@/lib/format';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import type { SaveEventArgs } from '@/queries/sql/events/saveEvent';
import { type PerformanceUpdate, UPSERT_PERFORMANCE_SQL } from './collect';

export async function savePerformance(args: SaveEventArgs, update: PerformanceUpdate) {
  const id = uuid('canquery-performance', args.websiteId, update.method, update.id);
  const connection = getRawQueryClient(prisma.client, { write: true });
  return connection.$executeRawUnsafe(
    UPSERT_PERFORMANCE_SQL,
    id,
    args.websiteId,
    args.sessionId,
    args.visitId,
    args.createdAt,
    truncateString(args.urlPath, FIELD_LENGTH.url),
    truncateString(args.pageTitle, FIELD_LENGTH.pageTitle),
    truncateString(args.hostname, FIELD_LENGTH.hostname),
    args.lcp ?? null,
    args.inp ?? null,
    args.cls ?? null,
    args.fcp ?? null,
    args.ttfb ?? null,
    update.method,
    update.revision,
    update.navigationType,
  );
}
