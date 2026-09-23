import type { LockRecord, LockStorage } from "../../src/sync/lock.js";

/**
 * MemoryLockRegistry — the in-memory fake of the pidfile lock storage
 * (design OD-4 names this fake pattern for task 3.4's tests). Exercises
 * the lock's acquisition/refusal/reclaim logic without touching the
 * filesystem; the file-backed storage gets its own focused tests.
 */
export class MemoryLockRegistry implements LockStorage {
  private record: LockRecord | null;

  constructor(preset: LockRecord | null = null) {
    this.record = preset;
  }

  async read(): Promise<LockRecord | null> {
    return this.record;
  }

  async write(record: LockRecord): Promise<void> {
    this.record = record;
  }

  async remove(): Promise<void> {
    this.record = null;
  }
}
