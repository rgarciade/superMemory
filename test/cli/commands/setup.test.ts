import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import { runSetup, type PromptPort } from "../../../src/cli/commands/setup.js";
import {
  EXAMPLE_CONFIG_FILENAME,
  PROJECT_CONFIG_FILENAME,
} from "../../../src/config/project-config.js";
import { makeProjectDir } from "../../helpers/project.js";

// Task 4.1 [RED first] add-project-config: setup rework (design AD-2).
// `runSetup(prompts, { basePath, homeDir })` — the launch directory and
// home are INJECTED (seam rule: no chdir, no process.env mutation, no
// HOME writes). Guards refuse the home root and any location outside a
// Git work tree (SETUP_LOCATION_REFUSED, pinned bytes) BEFORE any
// prompt or write; refusals write nothing. The legacy global config is
// never imported, never deleted — the hint test fakes the home path via
// injection and never touches the real one.

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

/** A throwaway valid vault: separate git repo + .memory/rules.md (current style). */
async function makeVault(prefix: string): Promise<string> {
  const vault = await mkdtemp(path.join(os.tmpdir(), prefix));
  const git = simpleGit(vault);
  await git.init();
  await git.addConfig("user.name", "Vault Git Identity");
  await git.addConfig("user.email", "vault-identity@example.com");
  await git.addConfig("commit.gpgsign", "false");
  await git.raw(["commit", "--allow-empty", "-m", "init"]);
  await mkdir(path.join(vault, ".memory"), { recursive: true });
  await writeFile(
    path.join(vault, ".memory", "rules.md"),
    "---\nformat_version: 1.0\n---\n",
    "utf8",
  );
  return vault;
}

const HOME_REFUSAL_MESSAGE = (dir: string): string =>
  `supermemory setup refuses to run in your home directory (${dir}): the home root is not an agent project.`;
const HOME_REFUSAL_HINT =
  'cd into the agent project\'s Git work tree (any subdirectory is fine) and re-run "supermemory setup". For vaults used outside any project, pass --vault or set SUPERMEMORY_VAULT.';
const WORKTREE_REFUSAL_MESSAGE = (dir: string): string =>
  `supermemory setup must run inside a Git work tree (${dir} is not one): it writes the project's supermemory.json at the work-tree root.`;
const WORKTREE_REFUSAL_HINT =
  'cd into the project where your agent works and re-run "supermemory setup". Inside a subdirectory is fine — setup writes at the work-tree root.';

describe("runSetup — location guards (AD-2)", () => {
  it("refuses the home root FIRST — even when the home directory is a git repository", async () => {
    // The fixture is `git init`ed (makeProjectDir), so findProjectRoot
    // would succeed here — this pins the guard ORDER: home-root check
    // runs before the work-tree check (home-as-dotfiles-repo case).
    const homeProject = await makeProjectDir();
    try {
      const prompts = scriptedPort({
        vaultPath: [],
        authorName: [],
        authorEmail: [],
        confirm: [],
      });
      const err = await runSetup(prompts, {
        basePath: homeProject.root,
        homeDir: homeProject.root,
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe("SETUP_LOCATION_REFUSED");
      expect(appErr.message).toBe(HOME_REFUSAL_MESSAGE(homeProject.root));
      expect(appErr.hint).toBe(HOME_REFUSAL_HINT);
      // Guards run before any prompt.
      expect(prompts.asked.vaultPath).toBe(0);
    } finally {
      await homeProject.cleanup();
    }
  });

  it("refuses a location outside any Git work tree", async () => {
    const plainDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-plain-"));
    try {
      const prompts = scriptedPort({
        vaultPath: [],
        authorName: [],
        authorEmail: [],
        confirm: [],
      });
      const err = await runSetup(prompts, {
        basePath: plainDir,
        homeDir: path.join(plainDir, "not-home"),
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe("SETUP_LOCATION_REFUSED");
      expect(appErr.message).toBe(WORKTREE_REFUSAL_MESSAGE(plainDir));
      expect(appErr.hint).toBe(WORKTREE_REFUSAL_HINT);
      expect(prompts.asked.vaultPath).toBe(0);
    } finally {
      await rm(plainDir, { recursive: true, force: true });
    }
  });

  it("refusals write nothing — no supermemory.json, no .gitignore change, no example file", async () => {
    const gitignoreBefore = "node_modules/\n";
    const project = await makeProjectDir({ gitignore: gitignoreBefore });
    try {
      const prompts = scriptedPort({
        vaultPath: [],
        authorName: [],
        authorEmail: [],
        confirm: [],
      });

      // Home-root refusal.
      await expect(
        runSetup(prompts, { basePath: project.root, homeDir: project.root }),
      ).rejects.toBeInstanceOf(AppError);
      // Non-work-tree refusal (plain sibling tmp dir).
      const plainDir = await mkdtemp(path.join(os.tmpdir(), "sm-setup-plain-"));
      try {
        await expect(
          runSetup(prompts, {
            basePath: plainDir,
            homeDir: path.join(plainDir, "not-home"),
          }),
        ).rejects.toBeInstanceOf(AppError);
      } finally {
        await rm(plainDir, { recursive: true, force: true });
      }

      expect(
        existsSync(path.join(project.root, PROJECT_CONFIG_FILENAME)),
      ).toBe(false);
      expect(
        existsSync(path.join(project.root, EXAMPLE_CONFIG_FILENAME)),
      ).toBe(false);
      const gitignoreAfter = await readFile(
        path.join(project.root, ".gitignore"),
        "utf8",
      );
      expect(gitignoreAfter).toBe(gitignoreBefore);
    } finally {
      await project.cleanup();
    }
  });

  it("a real agent project passes the guards and proceeds to the vault prompt", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-ok-v-");
    try {
      const prompts = scriptedPort({
        vaultPath: [vault],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      expect(prompts.asked.vaultPath).toBe(1);
      expect(result.vault).toBe(vault);
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });
});

describe("runSetup — vault loop and input expansion", () => {
  it("re-prompts until the vault path passes boot validation", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-rp-v-");
    try {
      const prompts = scriptedPort({
        vaultPath: ["/nonexistent/vault", vault],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      expect(result.vault).toBe(vault);
      expect(prompts.asked.vaultPath).toBe(2); // one bad, one good
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("stops re-prompting when the user declines to try another path", async () => {
    const project = await makeProjectDir();
    try {
      const prompts = scriptedPort({
        vaultPath: ["/nonexistent/vault-1", "/nonexistent/vault-2"],
        authorName: [],
        authorEmail: [],
        confirm: [false], // "Try another path?" -> No
      });
      await expect(
        runSetup(prompts, {
          basePath: project.root,
          homeDir: path.join(project.root, "not-home"),
        }),
      ).rejects.toBeInstanceOf(AppError);
      // Must stop after the first decline, not loop up to MAX_VAULT_ATTEMPTS.
      expect(prompts.asked.vaultPath).toBe(1);
    } finally {
      await project.cleanup();
    }
  });

  it("expands a leading ~ against the INJECTED home directory before validating", async () => {
    // Hermetic: the home is injected (io.homeDir), never process.env.HOME
    // and never the real user home.
    const project = await makeProjectDir();
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "sm-setup-home-"));
    const vault = path.join(fakeHome, "my-vault");
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
      const prompts = scriptedPort({
        vaultPath: ["~/my-vault"],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
      });
      const result = await runSetup(prompts, {
        basePath: project.root,
        homeDir: fakeHome,
      });
      expect(result.vault).toBe(vault);
    } finally {
      await project.cleanup();
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
