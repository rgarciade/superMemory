import { simpleGit } from "simple-git";
import type { TestVault } from "./create-test-vault.js";
import { createClone, createRemote } from "./create-remote.js";

/**
 * Wires a scaffolded test vault (createTestVault) to a hermetic bare
 * remote: pushes the vault's current branch with upstream tracking, and
 * offers `diverge()` — a throwaway clone pushes a competing edit to the
 * same branch, so the vault's next `pull --rebase` is exactly the P3
 * sync scenarios (clean replay, conflict, union merge). No network.
 */

export interface RemoteVault {
  vault: TestVault;
  remoteUrl: string;
  /** The vault's checked-out branch, now tracking origin. */
  branch: string;
  /**
   * Pushes `content` for `relPath` from a throwaway clone and fetches
   * it into the vault — the vault's origin/<branch> moves ahead while
   * its HEAD stays put (the pre-pull side of every sync scenario).
   */
  diverge(relPath: string, content: string, message?: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function connectVaultToRemote(vault: TestVault): Promise<RemoteVault> {
  const remote = await createRemote();
  const branch = (await vault.git.branchLocal()).current;
  await vault.git.addRemote("origin", remote.url);
  await vault.git.raw(["push", "--set-upstream", "origin", branch]);
  // Make the bare repo's HEAD point at the pushed branch so throwaway
  // clones of it check out something real regardless of git defaults.
  await simpleGit(remote.url).raw(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);

  async function diverge(relPath: string, content: string, message?: string): Promise<void> {
    const diverger = await createClone(remote.url, "diverger");
    try {
      await diverger.write(relPath, content);
      await diverger.commit(message ?? "test: divergent remote edit");
      await diverger.git.raw(["push", "origin", branch]);
      await vault.git.fetch("origin");
    } finally {
      await diverger.cleanup();
    }
  }

  return {
    vault,
    remoteUrl: remote.url,
    branch,
    diverge,
    cleanup: async () => {
      await vault.cleanup();
      await remote.cleanup();
    },
  };
}
