export interface Field {
  id: string;
  type: string;
  original_label?: string;
  legacy_ids?: string[];
}

export interface ApiEnvelope<T = unknown> {
  data: T;
  pagination?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  allowNoContent?: boolean;
  validate?: (body: ApiEnvelope) => boolean;
}

export interface ApiErrorBody {
  error?: string;
  hint?: string;
  retry_after?: number;
  code?: string;
  download_url?: string;
  failure_reason?: string;
}

export type ResourceView = 'table' | 'chart' | 'map';
export interface ResourceUrlState {
  q: string;
  columnFilters: Record<string, string>;
  sort: string | null;
  page: number;
  view: ResourceView;
}

export type FailureReason = 'invalid_file' | 'upstream_unavailable' | 'capacity' | 'temporary';
export type PreparationPhase = 'idle' | 'requesting' | 'pending' | 'running' | 'waiting' | 'failed' | 'unavailable';
export interface PreparationState {
  jobId: string | number | null;
  phase: PreparationPhase;
  retryAt: number | null;
  failureReason: FailureReason | null;
  attempt: number;
}
export type PreparationEvent =
  | { type: 'SOURCE_CHANGED' | 'READY_COPY' | 'JOB_COMPLETED' | 'JOB_GONE' | 'ADMISSION_STARTED' | 'RETRY_DUE' }
  | { type: 'METADATA_FAILED' | 'JOB_FAILED'; retryAt: number; reason: unknown }
  | { type: 'JOB_ADOPTED'; jobId: string | number }
  | { type: 'ADMISSION_REJECTED'; phase: PreparationPhase; retryAt: number | null; reason: unknown };
