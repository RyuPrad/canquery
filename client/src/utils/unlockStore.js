// Persist in-flight ingest ("unlock") job ids so the loading indicator survives
// a page refresh or navigation. The job lives in the backend queue; this just
// remembers which job belongs to which resource on this device. Keyed by
// resource id, written on enqueue, cleared when the job finishes.
const keyFor = (resourceId) => 'cq-unlock-job-' + resourceId;

export function readUnlockJob(resourceId) {
  if (!resourceId) return null;
  try {
    return localStorage.getItem(keyFor(resourceId));
  } catch {
    return null; // private mode / storage disabled
  }
}

export function writeUnlockJob(resourceId, jobId) {
  try {
    localStorage.setItem(keyFor(resourceId), String(jobId));
  } catch {
    // ignore - the indicator just won't survive a refresh
  }
}

export function clearUnlockJob(resourceId) {
  try {
    localStorage.removeItem(keyFor(resourceId));
  } catch {
    // ignore
  }
}
