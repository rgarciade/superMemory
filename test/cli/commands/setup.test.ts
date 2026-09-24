import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import {
  registerSetupCommand,
  runSetup,
  type PromptPort,
  type SetupResult,
} from "../../../src/cli/commands/setup.js";
import {
  EXAMPLE_CONFIG_CONTENT,
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
//
// Task 4.3 [RED second]: writes land at the work-tree root — fresh
// supermemory.json (no merge), one appended .gitignore line (N7
// semantics via appendMissingLines), the committed example file
// (created-when-absent, never overwritten, placeholder bytes, no
// author anywhere), the ≤5-attempt abort leaving zero artifacts, the
// pinned confirm bytes, and the one-time legacy hint (AD-4).

/** A scripted prompt port answering in order; records the questions. */
function scriptedPort(answers: {
  vaultPath: string[];
  authorName: string[];
  authorEmail: string[];
  confirm: boolean[];
  /** Raw answers for the timing prompts; omitted/empty ⇒ accept the default. */
  debounceSeconds?: string[];
  syncIntervalMinutes?: string[];
}): PromptPort & {
  asked: {
    vaultPath: number;
    authorName: number;
    authorEmail: number;
    confirm: number;
    debounceSeconds: number;
    syncIntervalMinutes: number;
  };
  /** Every prompt message, in ask order (wizard-string sweep). */
  messages: string[];
} {
  const state = {
    vaultPath: 0,
    authorName: 0,
    authorEmail: 0,
    confirm: 0,
    debounceSeconds: 0,
    syncIntervalMinutes: 0,
  };
  /** Shared by the two timing prompts: empty/absent answer ⇒ the default. */
  const timing = (
    key: "debounceSeconds" | "syncIntervalMinutes",
    self: { asked: Record<string, number> },
    message: string,
    def: number,
  ): string => {
    self.asked[key] = (self.asked[key] ?? 0) + 1;
    messages.push(message);
    const answer = answers[key]?.[state[key]];
    state[key] += 1;
    return answer === undefined || answer === "" ? String(def) : answer;
  };
  const messages: string[] = [];
  return {
    asked: {
      vaultPath: 0,
      authorName: 0,
      authorEmail: 0,
      confirm: 0,
      debounceSeconds: 0,
      syncIntervalMinutes: 0,
    },
    messages,
    async debounceSeconds(message: string, def: number): Promise<string> {
      return timing("debounceSeconds", this, message, def);
    },
    async syncIntervalMinutes(message: string, def: number): Promise<string> {
      return timing("syncIntervalMinutes", this, message, def);
    },
    async vaultPath(message: string): Promise<string> {
      this.asked.vaultPath += 1;
      messages.push(message);
      const answer = answers.vaultPath[state.vaultPath] ?? "";
      state.vaultPath += 1;
      return answer;
    },
    async authorName(message: string, def?: string): Promise<string> {
      this.asked.authorName += 1;
      messages.push(message);
      const answer = answers.authorName[state.authorName];
      state.authorName += 1;
      return answer === "" || answer === undefined ? (def ?? "") : answer;
    },
    async authorEmail(message: string, def?: string): Promise<string> {
      this.asked.authorEmail += 1;
      messages.push(message);
      const answer = answers.authorEmail[state.authorEmail];
      state.authorEmail += 1;
      return answer === "" || answer === undefined ? (def ?? "") : answer;
    },
    async confirm(message: string): Promise<boolean> {
      this.asked.confirm += 1;
      messages.push(message);
      const answer = answers.confirm[state.confirm];
      state.confirm += 1;
      return answer ?? true;
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

describe("runSetup — writes at the work-tree root (AD-2/AD-3/AD-5)", () => {
  const happyAnswers = (vault: string) => ({
    vaultPath: [vault],
    authorName: ["Raul"],
    authorEmail: ["raul@example.com"],
    confirm: [true],
  });

  it("writes all three artifacts at the WORK-TREE ROOT when launched from a subdirectory", async () => {
    // AD-2 × AD-1 agreement: setup and resolution share one definition
    // of "project root" — a subdir launch must land the artifacts where
    // a later subdir launch of serve/sync will read them.
    const project = await makeProjectDir({ nested: "packages/app" });
    const vault = await makeVault("sm-setup-sub-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      const result = await runSetup(prompts, {
        basePath: project.subdir as string,
        homeDir: path.join(project.root, "not-home"),
      });

      expect(result.root).toBe(project.root);
      expect(
        existsSync(path.join(project.root, PROJECT_CONFIG_FILENAME)),
      ).toBe(true);
      expect(
        existsSync(path.join(project.root, EXAMPLE_CONFIG_FILENAME)),
      ).toBe(true);
      expect(existsSync(path.join(project.root, ".gitignore"))).toBe(true);
      // Nothing at the launch subdirectory itself.
      expect(
        existsSync(path.join(project.subdir as string, PROJECT_CONFIG_FILENAME)),
      ).toBe(false);
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("rewrites the file FRESH on rerun — stale keys do not survive; serialization pinned", async () => {
    const project = await makeProjectDir({
      config: { vault: "/old/vault", legacy: true },
    });
    const vault = await makeVault("sm-setup-fresh-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });

      const raw = await readFile(
        path.join(project.root, PROJECT_CONFIG_FILENAME),
        "utf8",
      );
      // Byte-exact serialization contract (design §4.3): flat shape,
      // 2-space indent, trailing newline, vault first / author second.
      const expected =
        `{\n  "vault": ${JSON.stringify(vault)},\n` +
        `  "author": {\n    "name": "Raul",\n    "email": "raul@example.com"\n  }\n}\n`;
      expect(raw).toBe(expected);
      // Neither the old vault nor the stale key survives the rewrite.
      expect(raw).not.toContain("/old/vault");
      expect(raw).not.toContain("legacy");
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("defaults the author prompt from the vault's git identity — accepting defaults writes it", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-def-v-"); // identity: Vault Git Identity
    try {
      const prompts = scriptedPort({
        vaultPath: [vault],
        authorName: [""], // accept the default
        authorEmail: [""], // accept the default
        confirm: [true],
      });
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      const raw = JSON.parse(
        await readFile(
          path.join(project.root, PROJECT_CONFIG_FILENAME),
          "utf8",
        ),
      ) as { author: { name: string; email: string } };
      expect(raw.author.name).toBe("Vault Git Identity");
      expect(raw.author.email).toBe("vault-identity@example.com");
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("appends the gitignore line when missing; every other entry stays byte-unchanged", async () => {
    const project = await makeProjectDir({ gitignore: "node_modules/\n" });
    const vault = await makeVault("sm-setup-gi-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      const raw = await readFile(path.join(project.root, ".gitignore"), "utf8");
      expect(raw).toBe("node_modules/\nsupermemory.json\n");
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("gitignore append is idempotent across a second run — exactly one line", async () => {
    const project = await makeProjectDir({ gitignore: "node_modules/\n" });
    const vault = await makeVault("sm-setup-gi2-v-");
    try {
      await runSetup(scriptedPort(happyAnswers(vault)), {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      await runSetup(scriptedPort(happyAnswers(vault)), {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      const raw = await readFile(path.join(project.root, ".gitignore"), "utf8");
      expect(raw).toBe("node_modules/\nsupermemory.json\n");
      expect(raw.split("\n").filter((l) => l === "supermemory.json")).toHaveLength(1);
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("preserves a CRLF gitignore — the appended line uses the file's own EOL (N7 port)", async () => {
    const project = await makeProjectDir({ gitignore: "node_modules/\r\n" });
    const vault = await makeVault("sm-setup-crlf-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      const buf = await readFile(path.join(project.root, ".gitignore"));
      expect(buf.equals(Buffer.from("node_modules/\r\nsupermemory.json\r\n", "utf8"))).toBe(true);
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("creates supermemory.example.json when absent — exactly the pinned placeholder bytes, no author anywhere", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-ex-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      const raw = await readFile(
        path.join(project.root, EXAMPLE_CONFIG_FILENAME),
        "utf8",
      );
      expect(raw).toBe(EXAMPLE_CONFIG_CONTENT); // placeholder vault, never the answered path
      expect(raw).toContain("vault");
      expect(raw.toLowerCase()).not.toContain("author");
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("never overwrites a pre-placed (committed) example — byte-identical after setup", async () => {
    const committedExample = '{\n  "vault": "/team/vault/placeholder"\n}\n';
    const project = await makeProjectDir({ example: committedExample });
    const vault = await makeVault("sm-setup-ex2-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });
      const raw = await readFile(
        path.join(project.root, EXAMPLE_CONFIG_FILENAME),
        "utf8",
      );
      expect(raw).toBe(committedExample);
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("aborts after MAX_VAULT_ATTEMPTS = 5 invalid answers and leaves zero artifacts", async () => {
    const project = await makeProjectDir();
    try {
      const prompts = scriptedPort({
        vaultPath: [
          "/nonexistent/a",
          "/nonexistent/b",
          "/nonexistent/c",
          "/nonexistent/d",
          "/nonexistent/e",
        ],
        authorName: [],
        authorEmail: [],
        confirm: [true, true, true, true, true],
      });
      await expect(
        runSetup(prompts, {
          basePath: project.root,
          homeDir: path.join(project.root, "not-home"),
        }),
      ).rejects.toBeInstanceOf(AppError);
      expect(prompts.asked.vaultPath).toBe(5);
      expect(
        existsSync(path.join(project.root, PROJECT_CONFIG_FILENAME)),
      ).toBe(false);
      expect(
        existsSync(path.join(project.root, EXAMPLE_CONFIG_FILENAME)),
      ).toBe(false);
      expect(existsSync(path.join(project.root, ".gitignore"))).toBe(false);
    } finally {
      await project.cleanup();
    }
  });

  it("pins the confirm message bytes; no wizard string writes a config anywhere but the project", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-conf-v-");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      });

      const confirmMessage = prompts.messages.find(
        (m) => m.startsWith("Write "),
      );
      expect(confirmMessage).toBe(
        `Write supermemory.json in ${project.root} (vault ${vault}, author "Raul" <raul@example.com>)?`,
      );
      // The wizard (PromptPort flow) never logs and never mentions any
      // other config surface — the AD-4 legacy hint line lives at the
      // console edge, not in the wizard.
      for (const message of prompts.messages) {
        expect(message).not.toContain("global config");
      }
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  });
});

describe("runSetup — legacy global config hint (AD-4)", () => {
  const happyAnswers = (vault: string) => ({
    vaultPath: [vault],
    authorName: ["Raul"],
    authorEmail: ["raul@example.com"],
    confirm: [true],
  });

  it("sets SetupResult.legacyConfigPath when the legacy file exists under the INJECTED home; never reads or deletes it", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-legacy-v-");
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "sm-setup-legacy-h-"));
    const legacyDir = path.join(fakeHome, ".config", "supermemory");
    await mkdir(legacyDir, { recursive: true });
    const legacyPath = path.join(legacyDir, "config.json");
    const legacyBytes = '{\n  "vaults": { "default": "/LEAK/legacy-vault" }\n}\n';
    await writeFile(legacyPath, legacyBytes, "utf8");
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      const result = await runSetup(prompts, {
        basePath: project.root,
        homeDir: fakeHome,
      });
      expect(result.legacyConfigPath).toBe(legacyPath);
      // Never deleted, never modified.
      expect(await readFile(legacyPath, "utf8")).toBe(legacyBytes);
      // Never imported: the project file holds only the answered vault.
      const raw = await readFile(
        path.join(project.root, PROJECT_CONFIG_FILENAME),
        "utf8",
      );
      expect(raw).not.toContain("/LEAK/legacy-vault");
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("leaves legacyConfigPath undefined when the legacy file is absent", async () => {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-nolegacy-v-");
    const fakeHome = await mkdtemp(
      path.join(os.tmpdir(), "sm-setup-nolegacy-h-"),
    );
    try {
      const prompts = scriptedPort(happyAnswers(vault));
      const result = await runSetup(prompts, {
        basePath: project.root,
        homeDir: fakeHome,
      });
      expect(result.legacyConfigPath).toBeUndefined();
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});

describe("setup completion lines (console edge owns the log; wizard never logs)", () => {
  // Dynamic import keeps this RED observable per-test at 4.3 (the
  // export does not exist yet) without failing the whole suite file at
  // load time — the static-import load-failure RED pattern was already
  // used for whole-new files (W1/W2).
  async function completionLinesFn():
    Promise<((result: SetupResult) => string[]) | undefined> {
    const mod = (await import(
      "../../../src/cli/commands/setup.js"
    )) as unknown as Record<string, unknown>;
    return mod["setupCompletionLines"] as
      | ((result: SetupResult) => string[])
      | undefined;
  }

  it("emits exactly one legacy-hint line with the pinned bytes iff legacyConfigPath is present", async () => {
    const lines = await completionLinesFn();
    expect(lines).toBeTypeOf("function");
    if (lines === undefined) return; // keep the RED message above clean
    const withLegacy = {
      root: "/p",
      vault: "/v",
      author: { name: "Raul", email: "raul@example.com" },
      legacyConfigPath: "/home/.config/supermemory/config.json",
    } as SetupResult;
    const out = lines(withLegacy);
    expect(out).toHaveLength(2); // completion + EXACTLY ONE legacy line
    expect(out[1]).toBe(
      "legacy global config found at /home/.config/supermemory/config.json — supermemory no longer reads it. You may delete it manually.",
    );
  });

  it("emits no legacy line when legacyConfigPath is absent", async () => {
    const lines = await completionLinesFn();
    expect(lines).toBeTypeOf("function");
    if (lines === undefined) return;
    const withoutLegacy = {
      root: "/p",
      vault: "/v",
      author: { name: "Raul", email: "raul@example.com" },
    } as SetupResult;
    const out = lines(withoutLegacy);
    expect(out).toHaveLength(1); // completion only
    expect(out.join("\n")).not.toContain("legacy global config");
  });
});

describe("registerSetupCommand (commander edge owns the log)", () => {
  // New-seam tests: the injectable runner + the completion logging land
  // together in 4.4 (driving the OLD action would run @inquirer on a
  // non-TTY stdin). The bytes asserted here were RED-pinned in 4.3 via
  // setupCompletionLines; this pins the ambient-edge injection and the
  // action-side "exactly one legacy line" wiring.
  function fakeResult(legacyConfigPath?: string): SetupResult {
    return {
      root: "/p",
      vault: "/v",
      author: { name: "Raul", email: "raul@example.com" },
      ...(legacyConfigPath !== undefined ? { legacyConfigPath } : {}),
    } as SetupResult;
  }

  async function captureActionLog(result: SetupResult): Promise<{
    seen: { basePath: string; homeDir: string }[];
    lines: string[];
  }> {
    const program = new Command().exitOverride();
    const seen: { basePath: string; homeDir: string }[] = [];
    // Log-level determinism: createLogger reads SUPERMEMORY_LOG_LEVEL at
    // construction — pin it for this test (save/restore; never for
    // discovery, so the seam rule is untouched).
    const savedLevel = process.env["SUPERMEMORY_LOG_LEVEL"];
    process.env["SUPERMEMORY_LOG_LEVEL"] = "info";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      registerSetupCommand(program, async (io) => {
        seen.push(io);
        return result;
      });
      await program.parseAsync(["setup"], { from: "user" });
      const lines = errSpy.mock.calls.map((c) => String(c[0]));
      return { seen, lines };
    } finally {
      errSpy.mockRestore();
      if (savedLevel === undefined) {
        delete process.env["SUPERMEMORY_LOG_LEVEL"];
      } else {
        process.env["SUPERMEMORY_LOG_LEVEL"] = savedLevel;
      }
    }
  }

  it("injects the ambient edge and logs EXACTLY ONE legacy line when one is present", async () => {
    const { seen, lines } = await captureActionLog(
      fakeResult("/home/.config/supermemory/config.json"),
    );
    // The commander action is the ONE ambient edge (AD-2).
    expect(seen).toHaveLength(1);
    expect(seen[0]?.basePath).toBe(process.cwd());
    expect(seen[0]?.homeDir).toBe(os.homedir());
    const legacyLines = lines.filter((l) =>
      l.includes("legacy global config found at"),
    );
    expect(legacyLines).toHaveLength(1);
    expect(legacyLines[0]).toContain(
      "legacy global config found at /home/.config/supermemory/config.json — supermemory no longer reads it. You may delete it manually.",
    );
    // The completion line keeps the "global config" language out.
    expect(lines.some((l) => l.includes("setup complete"))).toBe(true);
  });

  it("logs no legacy line when the result has none", async () => {
    const { lines } = await captureActionLog(fakeResult());
    expect(lines.filter((l) => l.includes("legacy global config"))).toHaveLength(0);
    expect(lines.some((l) => l.includes("setup complete"))).toBe(true);
  });
});

describe("runSetup — sync timing prompts (issue #5)", () => {
  async function runWith(
    timings: { debounceSeconds?: string[]; syncIntervalMinutes?: string[] },
  ): Promise<{
    prompts: ReturnType<typeof scriptedPort>;
    result: SetupResult | unknown;
    written: Record<string, unknown>;
  }> {
    const project = await makeProjectDir();
    const vault = await makeVault("sm-setup-timing-v-");
    try {
      const prompts = scriptedPort({
        vaultPath: [vault],
        authorName: ["Raul"],
        authorEmail: ["raul@example.com"],
        confirm: [true],
        ...timings,
      });
      const result = await runSetup(prompts, {
        basePath: project.root,
        homeDir: path.join(project.root, "not-home"),
      }).catch((e: unknown) => e);
      let written: Record<string, unknown> = {};
      try {
        written = JSON.parse(
          await readFile(path.join(project.root, PROJECT_CONFIG_FILENAME), "utf8"),
        ) as Record<string, unknown>;
      } catch {
        // nothing written (failure path)
      }
      return { prompts, result, written };
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
    }
  }

  it("defaults are 45 s / 15 min and leave supermemory.json without timing keys", async () => {
    const { prompts, written, result } = await runWith({});
    expect(prompts.asked.debounceSeconds).toBe(1);
    expect(prompts.asked.syncIntervalMinutes).toBe(1);
    expect(result).toMatchObject({ debounceSeconds: 45, syncIntervalMinutes: 15 });
    expect(written).not.toHaveProperty("debounceSeconds");
    expect(written).not.toHaveProperty("syncIntervalMinutes");
  });

  it("custom values are persisted in supermemory.json", async () => {
    const { written, result } = await runWith({
      debounceSeconds: ["10"],
      syncIntervalMinutes: ["5"],
    });
    expect(result).toMatchObject({ debounceSeconds: 10, syncIntervalMinutes: 5 });
    expect(written["debounceSeconds"]).toBe(10);
    expect(written["syncIntervalMinutes"]).toBe(5);
  });

  it("re-prompts on invalid input (non-numeric, zero, negative, fractional, out of bounds)", async () => {
    const { prompts, written } = await runWith({
      debounceSeconds: ["abc", "-4", "1.5", "99999", "30"],
      syncIntervalMinutes: ["0", "2000", "10"],
    });
    expect(prompts.asked.debounceSeconds).toBe(5);
    expect(written["debounceSeconds"]).toBe(30);
    expect(prompts.asked.syncIntervalMinutes).toBe(3);
    expect(written["syncIntervalMinutes"]).toBe(10);
  });

  it("aborts with INVALID_SYNC_SETTING after repeated invalid input and writes nothing", async () => {
    const { result, written } = await runWith({
      debounceSeconds: ["x", "x", "x", "x", "x"],
    });
    expect(result).toBeInstanceOf(AppError);
    expect((result as AppError).code).toBe("INVALID_SYNC_SETTING");
    expect(written).toEqual({});
  });
});
