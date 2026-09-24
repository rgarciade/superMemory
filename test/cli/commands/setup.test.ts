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
// prompt or write; refusals write nothing. The home path is
// faked via injection; the real one is never touched.
//
// Task 4.3 [RED second]: writes land at the work-tree root — fresh
// supermemory.json (no merge), one appended .gitignore line (N7
// semantics via appendMissingLines), the committed example file
// (created-when-absent, never overwritten, placeholder bytes, no
// author anywhere), the ≤5-attempt abort leaving zero artifacts, the
// pinned confirm bytes.

/** A scripted prompt port answering in order; records the questions. */
function scriptedPort(answers: {
  vaultPath: string[];
  authorName: string[];
  authorEmail: string[];
  confirm: boolean[];
}): PromptPort & {
  asked: {
    vaultPath: number;
    authorName: number;
    authorEmail: number;
    confirm: number;
  };
  /** Every prompt message, in ask order (wizard-string sweep). */
  messages: string[];
} {
  const state = { vaultPath: 0, authorName: 0, authorEmail: 0, confirm: 0 };
  const messages: string[] = [];
  return {
    asked: { vaultPath: 0, authorName: 0, authorEmail: 0, confirm: 0 },
    messages,
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
      config: { vault: "/old/vault", stale: true },
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
      expect(raw).not.toContain("stale");
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
      // other config surface.
      for (const message of prompts.messages) {
        expect(message).not.toContain("global config");
      }
    } finally {
      await project.cleanup();
      await rm(vault, { recursive: true, force: true });
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

  it("emits only the completion line", async () => {
    const lines = await completionLinesFn();
    expect(lines).toBeTypeOf("function");
    if (lines === undefined) return;
    const result = {
      root: "/p",
      vault: "/v",
      author: { name: "Raul", email: "raul@example.com" },
    } as SetupResult;
    const out = lines(result);
    expect(out).toHaveLength(1); // completion only
    });
});

describe("registerSetupCommand (commander edge owns the log)", () => {
  // Pins the ambient-edge injection and the completion logging.
  function fakeResult(): SetupResult {
    return {
      root: "/p",
      vault: "/v",
      author: { name: "Raul", email: "raul@example.com" },
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

  it("injects the ambient edge and logs the completion line", async () => {
    const { seen, lines } = await captureActionLog(fakeResult());
    // The commander action is the ONE ambient edge (AD-2).
    expect(seen).toHaveLength(1);
    expect(seen[0]?.basePath).toBe(process.cwd());
    expect(seen[0]?.homeDir).toBe(os.homedir());
    expect(lines.some((l) => l.includes("setup complete"))).toBe(true);
  });
});
