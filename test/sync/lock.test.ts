import { describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PidfileLock,
  SYNC_LOCK_FILE_NAME,
  isProcessAlive,
  type LockOwner,
} from "../../src/sync/lock.js";
import { MemoryLockRegistry } from "../helpers/memory-lock-registry.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Load-sensitive real-git timeouts under parallel workers (add-m1-core verify finding #3).
vi.setConfig({ testTimeout: 20_000 });

// Task 3.4 [RED first]: lock.ts — SyncLock/LockHandle + PidfileLock at
// .memory/cache/supermemory-sync.lock (OD-4): live-pid check (ESRCH-safe),
// stale reclaim after rewrite, release deletes. Acquisition logic is
// exercised through the MemoryLockRegistry fake; the file-backed storage
// gets focused pidfile tests.

const FIXED_NOW = new Date("2026-07-14T10:30:00.000Z");

function fixedClock() {
  return { now: () => new Date(FIXED_NOW) };
}

/** A PidfileLock built on the memory fake with controllable pid/liveness. */
function fakeLock(opts: {
  pid: number;
  otherPidAlive?: (pid: number) => boolean;
  storage?: MemoryLockRegistry;
}) {
  const storage = opts.storage ?? new MemoryLockRegistry();
  const lock = new PidfileLock({
    storage,
    pid: opts.pid,
    isPidAlive: opts.otherPidAlive ?? (() => true),
    clock: fixedClock(),
  });
  return { lock, storage };
}

describe("PidfileLock over MemoryLockRegistry — the four OD-4 scenarios", () => {
  it("single-owner acquisition: writes { pid, owner, acquiredAt } and hands out the handle", async () => {
    const { lock, storage } = fakeLock({ pid: 111 });
    const handle = await lock.acquire("server");
    expect(handle).not.toBeNull();
    expect(handle?.owner).toBe<LockOwner>("server");
    expect(handle?.pid).toBe(111);
    expect(await storage.read()).toEqual({
      pid: 111,
      owner: "server",
      acquiredAt: FIXED_NOW.toISOString(),
    });
  });

  it("second-actor refusal: a live other owner's lock returns null, record untouched", async () => {
    const registry = new MemoryLockRegistry();
    const { lock: serverLock } = fakeLock({ pid: 111, storage: registry });
    await serverLock.acquire("server");

    // A distinct actor (its own pid) reading the SAME registry, with the
    // holder's pid alive.
    const { lock: cliLock } = fakeLock({
      pid: 222,
      otherPidAlive: () => true,
      storage: registry,
    });
    const handle = await cliLock.acquire("cli");
    expect(handle).toBeNull();
    // The holder's record survives the refusal.
    expect((await registry.read())?.pid).toBe(111);
  });

  it("stale reclaim: a dead holder's pidfile is rewritten for the new owner", async () => {
    const storage = new MemoryLockRegistry({
      pid: 999,
      owner: "server",
      acquiredAt: "2026-01-01T00:00:00.000Z",
    });
    // Only pid 999 is dead; anything else (us) counts as alive.
    const { lock } = fakeLock({
      pid: 111,
      otherPidAlive: (pid) => pid !== 999,
      storage,
    });

    const handle = await lock.acquire("cli");
    expect(handle).not.toBeNull();
    expect(handle?.pid).toBe(111);
    // Reclaimed "after rewrite": the record now names the new owner.
    expect(await storage.read()).toEqual({
      pid: 111,
      owner: "cli",
      acquiredAt: FIXED_NOW.toISOString(),
    });
  });

  it("release-reacquire: release deletes the record; the next acquire succeeds", async () => {
    const { lock, storage } = fakeLock({ pid: 111 });
    const first = await lock.acquire("server");
    expect(first).not.toBeNull();
    await first?.release();
    expect(await storage.read()).toBeNull();

    const second = await lock.acquire("cli");
    expect(second).not.toBeNull();
    expect(second?.owner).toBe<LockOwner>("cli");
  });
});

describe("PidfileLock — remaining semantics", () => {
  it("the same process re-acquiring rewrites its own record (same pid is not 'another actor')", async () => {
    const { lock, storage } = fakeLock({ pid: 111 });
    await lock.acquire("server");
    const again = await lock.acquire("cli");
    expect(again).not.toBeNull();
    expect((await storage.read())?.owner).toBe<LockOwner>("cli");
  });

  it("release is idempotent — a second release never throws", async () => {
    const { lock } = fakeLock({ pid: 111 });
    const handle = await lock.acquire("server");
    await handle?.release();
    await expect(handle?.release()).resolves.toBeUndefined();
  });

  it("currentHolder reads the record for the ownership report (M1: report, don't delegate)", async () => {
    const storage = new MemoryLockRegistry({
      pid: 4242,
      owner: "server",
      acquiredAt: FIXED_NOW.toISOString(),
    });
    const { lock } = fakeLock({ pid: 111, otherPidAlive: () => true, storage });
    expect(await lock.currentHolder()).toEqual({
      pid: 4242,
      owner: "server",
      acquiredAt: FIXED_NOW.toISOString(),
    });
  });
});

describe("PidfileLock — file-backed pidfile storage", () => {
  it("writes the lockfile at .memory/cache/supermemory-sync.lock with the record JSON", async () => {
    const vault = await createTestVault();
    try {
      const lock = new PidfileLock({
        vaultRoot: vault.root,
        pid: 111,
        isPidAlive: () => true,
        clock: fixedClock(),
      });
      const handle = await lock.acquire("server");
      expect(handle?.pid).toBe(111);

      const lockPath = path.join(
        vault.root,
        ".memory",
        "cache",
        SYNC_LOCK_FILE_NAME,
      );
      const raw = await readFile(lockPath, "utf8");
      expect(JSON.parse(raw)).toEqual({
        pid: 111,
        owner: "server",
        acquiredAt: FIXED_NOW.toISOString(),
      });
    } finally {
      await vault.cleanup();
    }
  });

  it("release deletes the pidfile", async () => {
    const vault = await createTestVault();
    try {
      const lock = new PidfileLock({
        vaultRoot: vault.root,
        pid: 111,
        isPidAlive: () => true,
        clock: fixedClock(),
      });
      const handle = await lock.acquire("server");
      const lockPath = path.join(vault.root, ".memory", "cache", SYNC_LOCK_FILE_NAME);
      await handle?.release();
      await expect(readFile(lockPath, "utf8")).rejects.toThrow();
    } finally {
      await vault.cleanup();
    }
  });

  it("treats a corrupted pidfile as stale and reclaims it", async () => {
    const vault = await createTestVault();
    try {
      const lockPath = path.join(vault.root, ".memory", "cache", SYNC_LOCK_FILE_NAME);
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(lockPath, "not json at all", "utf8");

      const lock = new PidfileLock({
        vaultRoot: vault.root,
        pid: 111,
        isPidAlive: () => true,
        clock: fixedClock(),
      });
      const handle = await lock.acquire("cli");
      expect(handle).not.toBeNull();
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({ pid: 111 });
    } finally {
      await vault.cleanup();
    }
  });
});

describe("isProcessAlive — the ESRCH-safe liveness check", () => {
  it("reports our own pid as alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("reports a pid beyond any pid_max as dead (ESRCH)", () => {
    expect(isProcessAlive(2 ** 31 - 1)).toBe(false);
  });

  it("never throws for a privileged pid (EPERM means alive)", () => {
    expect(() => isProcessAlive(1)).not.toThrow();
  });
});
