import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import { runSetup, type PromptPort } from "../../../src/cli/commands/setup.js";
import type { EnvSource } from "../../../src/config/env.js";

// Task 1.18 [RED first]: setup wizard — validated vault path, author
// identity, writes global config (vaults.default). The PromptPort seam
// keeps @inquirer/prompts at the edge; tests inject a scripted port.

function envWith(configDir: string): EnvSource {
  return {
    get: (name) => (name === "SUPERMEMORY_CONFIG_DIR" ? configDir : undefined),
  };
}

/** A scripted prompt port answering in order; records the questions. */
function scriptedPort(answers: {
  vaultPath: string[];
  authorName: string[];
  authorEmail: string[];
  confirm: boolean[];
}): PromptPort & {
  asked: { vaultPath: number; authorName: number; authorEmail: number };
} {
  const state = { vaultPath: 0, authorName: 0, authorEmail: 0 };
  return {
    asked: { vaultPath: 0, authorName: 0, authorEmail: 0 },
    async vaultPath(_message: string): Promise<string> {
      this.asked.vaultPath += 1;
      const answer = answers.vaultPath[state.vaultPath] ?? "";
      state.vaultPath += 1;
      return answer;
    },
    async authorName(_message: string, def?: string): Promise<string> {
      this.asked.authorName += 1;
      const answer = answers.authorName[state.authorName];
      state.authorName += 1;
      return answer === "" || answer === undefined ? (def ?? "") : answer;
    },
    async authorEmail(_message: string, def?: string): Promise<string> {
      this.asked.authorEmail += 1;
      const answer = answers.authorEmail[state.authorEmail];
      state.authorEmail += 1;
      return answer === "" || answer === undefined ? (def ?? "") : answer;
    },
    async confirm(_message: string): Promise<boolean> {
      return answers.confirm[0] ?? true;
    },
  };
}

describe("runSetup", () => {
  it("writes vaults.default and author into the global config", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-"));
    const vault = await mkdtemp(path.join(os.tmpdir(), "sm-setup-vault-"));
    const git = simpleGit(vault);
    await git.init();
    await git.addConfig("user.name", "Git Default");
    await git.addConfig("user.email", "git@example.com");
    await git.addConfig("commit.gpgsign", "false");
    try {
      await simpleGit(vault).raw([
        "commit",
        "--allow-empty",
        "-m",
        "init",
      ]);
      // minimal rules.md so the vault validates
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.join(vault, ".memory"), { recursive: true });
      await writeFile(
        path.join(vault, ".memory", "rules.md"),
        "---\nformat_version: 1.0\n---\n",
        "utf8",
      );

      const prompts = scriptedPort({
        vaultPath: [vault],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, envWith(configDir));

      expect(result.vault).toBe(vault);
      const raw = JSON.parse(
        await readFile(path.join(configDir, "config.json"), "utf8"),
      ) as {
        vaults: { default: string };
        author: { name: string; email: string };
      };
      expect(raw.vaults.default).toBe(vault);
      expect(raw.author.name).toBe("Raul");
      expect(raw.author.email).toBe("raul@example.com");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("re-prompts until the vault path passes boot validation", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-rp-"));
    const vault = await mkdtemp(path.join(os.tmpdir(), "sm-setup-rp-v-"));
    const git = simpleGit(vault);
    await git.init();
    await git.addConfig("user.name", "Test User");
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("commit.gpgsign", "false");
    await git.raw(["commit", "--allow-empty", "-m", "init"]);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(vault, ".memory"), { recursive: true });
    await writeFile(
      path.join(vault, ".memory", "rules.md"),
      "---\nformat_version: 1.0\n---\n",
      "utf8",
    );
    try {
      const prompts = scriptedPort({
        vaultPath: ["/nonexistent/vault", vault],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, envWith(configDir));
      expect(result.vault).toBe(vault);
      expect(prompts.asked.vaultPath).toBe(2); // one bad, one good
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("defaults author identity from the vault's git config", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-def-"));
    const vault = await mkdtemp(path.join(os.tmpdir(), "sm-setup-def-v-"));
    const git = simpleGit(vault);
    await git.init();
    await git.addConfig("user.name", "Git Default");
    await git.addConfig("user.email", "git@example.com");
    await git.addConfig("commit.gpgsign", "false");
    await git.raw(["commit", "--allow-empty", "-m", "init"]);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(vault, ".memory"), { recursive: true });
    await writeFile(
      path.join(vault, ".memory", "rules.md"),
      "---\nformat_version: 1.0\n---\n",
      "utf8",
    );
    try {
      const prompts = scriptedPort({
        vaultPath: [vault],
        authorName: [""], // accept default
        authorEmail: [""],
        confirm: [true],
      });
      await runSetup(prompts, envWith(configDir));
      const raw = JSON.parse(
        await readFile(path.join(configDir, "config.json"), "utf8"),
      ) as { author: { name: string; email: string } };
      expect(raw.author.name).toBe("Git Default");
      expect(raw.author.email).toBe("git@example.com");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("resolves a relative vault path to an absolute path (so it still resolves after a cwd change)", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-rel-"));
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-rel-v-"));
    const vault = path.join(parentDir, "vault");
    await mkdir(vault, { recursive: true });
    const git = simpleGit(vault);
    await git.init();
    await git.addConfig("user.name", "Test User");
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("commit.gpgsign", "false");
    await git.raw(["commit", "--allow-empty", "-m", "init"]);
    await mkdir(path.join(vault, ".memory"), { recursive: true });
    await writeFile(
      path.join(vault, ".memory", "rules.md"),
      "---\nformat_version: 1.0\n---\n",
      "utf8",
    );
    try {
      const relPath = path.relative(process.cwd(), vault);
      const prompts = scriptedPort({
        vaultPath: [relPath],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, envWith(configDir));
      expect(path.isAbsolute(result.vault)).toBe(true);
      expect(result.vault).toBe(vault);
      const raw = JSON.parse(
        await readFile(path.join(configDir, "config.json"), "utf8"),
      ) as { vaults: { default: string } };
      expect(path.isAbsolute(raw.vaults.default)).toBe(true);
      expect(raw.vaults.default).toBe(vault);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("expands a leading ~ to the home directory before validating and saving", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-home-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-home-h-"));
    const vault = path.join(homeDir, "my-vault");
    await mkdir(vault, { recursive: true });
    const git = simpleGit(vault);
    await git.init();
    await git.addConfig("user.name", "Test User");
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("commit.gpgsign", "false");
    await git.raw(["commit", "--allow-empty", "-m", "init"]);
    await mkdir(path.join(vault, ".memory"), { recursive: true });
    await writeFile(
      path.join(vault, ".memory", "rules.md"),
      "---\nformat_version: 1.0\n---\n",
      "utf8",
    );
    const originalHome = process.env["HOME"];
    process.env["HOME"] = homeDir;
    try {
      const prompts = scriptedPort({
        vaultPath: ["~/my-vault"],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, envWith(configDir));
      expect(result.vault).toBe(vault);
    } finally {
      if (originalHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = originalHome;
      }
      await rm(configDir, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("stops re-prompting when the user declines to try another path", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-decline-"));
    try {
      const prompts = scriptedPort({
        vaultPath: ["/nonexistent/vault-1", "/nonexistent/vault-2"],
        authorName: [],
        authorEmail: [],
        confirm: [false], // "Try another path?" -> No
      });
      await expect(runSetup(prompts, envWith(configDir))).rejects.toBeInstanceOf(
        AppError,
      );
      // Must stop after the first decline, not loop up to MAX_VAULT_ATTEMPTS.
      expect(prompts.asked.vaultPath).toBe(1);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
