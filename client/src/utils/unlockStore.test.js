import { describe, it, expect, beforeEach } from 'vitest';
import { readUnlockJob, writeUnlockJob, clearUnlockJob } from './unlockStore.js';

describe('unlockStore', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing is stored', () => {
    expect(readUnlockJob('r1')).toBeNull();
  });

  it('persists a job id per resource and reads it back as a string', () => {
    writeUnlockJob('r1', 42);
    expect(readUnlockJob('r1')).toBe('42');
    expect(readUnlockJob('r2')).toBeNull();
  });

  it('clears only the targeted resource', () => {
    writeUnlockJob('r1', 7);
    writeUnlockJob('r2', 8);
    clearUnlockJob('r1');
    expect(readUnlockJob('r1')).toBeNull();
    expect(readUnlockJob('r2')).toBe('8');
  });

  it('treats a missing resource id as nothing stored', () => {
    expect(readUnlockJob(undefined)).toBeNull();
    expect(readUnlockJob(null)).toBeNull();
  });
});
