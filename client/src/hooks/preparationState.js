const FAILURE_REASONS = new Set(['invalid_file', 'upstream_unavailable', 'capacity', 'temporary']);
export const publicReason = value => FAILURE_REASONS.has(value) ? value : null;
export function retryTime(value) {
  const time = value ? new Date(value).getTime() : null;
  return Number.isFinite(time) ? time : null;
}

export function initialPreparationState(jobId) {
  return { jobId, phase: jobId ? 'pending' : 'idle', retryAt: null, failureReason: null, attempt: 0 };
}

// Only local lifecycle state lives here. Network requests, persistent shared
// job ownership, metadata, visibility and clock effects stay in the hook.
export function preparationReducer(state, event) {
  switch (event.type) {
    case 'SOURCE_CHANGED':
    case 'READY_COPY':
      return { ...state, phase: 'idle', retryAt: null, failureReason: null };
    case 'METADATA_FAILED':
      return { ...state, phase: 'failed', retryAt: event.retryAt, failureReason: publicReason(event.reason) };
    case 'JOB_COMPLETED':
      return { ...state, jobId: null, phase: 'idle', retryAt: null, failureReason: null };
    case 'JOB_FAILED':
      return { ...state, jobId: null, phase: 'failed', retryAt: event.retryAt, failureReason: publicReason(event.reason) };
    case 'JOB_GONE':
      return { ...state, jobId: null, phase: 'idle', failureReason: null, attempt: state.attempt + 1 };
    case 'JOB_ADOPTED':
      return { ...state, jobId: event.jobId, phase: 'pending', retryAt: null, failureReason: null };
    case 'ADMISSION_STARTED':
      return { ...state, phase: 'requesting', failureReason: null };
    case 'ADMISSION_REJECTED':
      return { ...state, phase: event.phase, retryAt: event.retryAt, failureReason: publicReason(event.reason) };
    case 'RETRY_DUE':
      return { ...state, phase: 'idle', retryAt: null, failureReason: null, attempt: state.attempt + 1 };
    default:
      throw new Error('Unknown preparation transition: ' + event.type);
  }
}
