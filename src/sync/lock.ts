import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SystemClock, type Clock } from "../util/clock.js";

/**
 * Single sync owner per clone (OD-4 / sync-ladder spec). Production uses
 * a pidfile at `.memory/cache/supermemory-sync.lock`; the record holds
 * `{ pid, owner, acquiredAt }`.
 *
 * Acquisition semantics:
 * - no record, or a record whose pid is dead (stale), or a record naming
 *   *this* pid ⇒ write our record and take the lock (stale reclaim is
 *   simply "rewrite, then hold").
 * - a record held by a **live** other actor ⇒ `acquire` returns `null`;
 *   the caller reports ownership (M1: report, don't delegate — there is
 *   no IPC channel any spec defines).
 *
 * Liveness is `process.kill(pid, 0)`, ESRCH-safe: ESRCH means dead,
 * EPERM means alive (exists, owned by another user), anything else
 * propagates.
 */

/** M1's two sync actors (OD-4); keeps the door open for delegation in M2. */
export type LockOwner = "server" | "cli";

export interface LockRecord {
  pid: number;
  owner: LockOwner;
  acquiredAt: string;
}

export interface LockHandle {
  owner: LockOwner;
  pid: number;
  release(): Promise<void>;
}

export interface SyncLock {
  /** `null` = held by a live other actor (report, never race). */
  acquire(owner: LockOwner): Promise<LockHandle | null>;
  /**
   * Current holder for the ownership report (M1: report, don't delegate).
   * Optional — a lock implementation without readable storage omits it.
   */
  currentHolder?(): Promise<LockRecord | null>;
}

/** The persistence seam: pidfile in production, MemoryLockRegistry in tests. */
export interface LockStorage {
  read(): Promise<LockRecord | null>;
  write(record: LockRecord): Promise<void>;
  remove(): Promise<void>;
}

export const SYNC_LOCK_FILE_NAME = "supermemory-sync.lock";

/** ESRCH-safe pid liveness: signal 0 probes existence without signaling. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true; // exists, owned by another user
    throw error;
  }
}

/** File-backed record storage (the production lock's persistence). */
class FileLockStorage implements LockStorage {
  constructor(private readonly lockPath: string) {}

  async read(): Promise<LockRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.lockPath, "utf8");
    } catch {
      return null; // no pidfile = not held
    }
    try {
      const parsed = JSON.parse(raw) as LockRecord;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.pid !== "number" ||
        (parsed.owner !== "server" && parsed.owner !== "cli")
      ) {
        return null; // corrupted: treated as stale, reclaimable
      }
      return parsed;
    } catch {
      return null; // corrupted: treated as stale, reclaimable
    }
  }

  async write(record: LockRecord): Promise<void> {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    await writeFile(this.lockPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async remove(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }
}

export interface PidfileLockOptions {
  /** Explicit lock path (wins over vaultRoot). */
  lockPath?: string;
  /** Vault root — the lock lands at .memory/cache/<SYNC_LOCK_FILE_NAME>. */
  vaultRoot?: string;
  /** Default: file storage at the resolved lock path. */
  storage?: LockStorage;
  /** The pid we act for; default `process.pid`. */
  pid?: number;
  /** Liveness probe for foreign pids; default the ESRCH-safe `isProcessAlive`. */
  isPidAlive?: (pid: number) => boolean;
  /** Default: SystemClock (OD-4 — every timestamp goes through Clock). */
  clock?: Clock;
}

export class PidfileLock implements SyncLock {
  private readonly storage: LockStorage;
  private readonly pid: number;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly clock: Clock;

  constructor(opts: PidfileLockOptions = {}) {
    const lockPath =
      opts.lockPath ??
      path.join(opts.vaultRoot ?? process.cwd(), ".memory", "cache", SYNC_LOCK_FILE_NAME);
    this.storage = opts.storage ?? new FileLockStorage(lockPath);
    this.pid = opts.pid ?? process.pid;
    this.isPidAlive = opts.isPidAlive ?? isProcessAlive;
    this.clock = opts.clock ?? new SystemClock();
  }

  async acquire(owner: LockOwner): Promise<LockHandle | null> {
    const existing = await this.storage.read();
    if (existing !== null && existing.pid !== this.pid && this.isPidAlive(existing.pid)) {
      return null; // held by a live other actor
    }
    // Absent, stale (dead pid), or already ours: rewrite and hold.
    await this.storage.write({
      pid: this.pid,
      owner,
      acquiredAt: this.clock.now().toISOString(),
    });
    let released = false;
    return {
      owner,
      pid: this.pid,
      release: async () => {
        if (released) return; // idempotent
        released = true;
        await this.storage.remove();
      },
    };
  }

  /** Reads the current holder for the ownership report (OD-4). */
  async currentHolder(): Promise<LockRecord | null> {
    return this.storage.read();
  }
}
