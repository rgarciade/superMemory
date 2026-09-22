import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
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
});
