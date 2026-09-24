import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectConfig } from "../../src/config/project-config.js";
import {
  EXAMPLE_CONFIG_CONTENT,
  EXAMPLE_CONFIG_FILENAME,
  PROJECT_CONFIG_FILENAME,
  findProjectRoot,
  loadProjectConfig,
  projectAuthor,
  projectConfigPath,
  resolveVaultPath,
} from "../../src/config/project-config.js";
import type { EnvSource } from "../../src/config/env.js";
import { makeProjectDir } from "../helpers/project.js";

// Task 2.1 [RED first]: the project-config module contracts (design AD-1/AD-6;
// specs/project-config). Hermetic by construction: every fixture lives in a
// mkdtemp work tree from makeProjectDir, the EnvSource is a stub — tests never
// chdir, never mutate process.env, never touch the real HOME, never spawn
// anything but local `git init`.

/** Stub EnvSource from plain entries — no process.env is ever touched. */
function envWith(entries: Record<string, string>): EnvSource {
  return { get: (name) => entries[name] };
}

const execFileAsync = promisify(execFile);

const ABSOLUTE_VAULT = "/Users/me/vaults/notes";

/** A config object whose author field may be intentionally malformed. */
function configWithAuthor(author: unknown): ProjectConfig {
  return author === undefined
    ? { vault: ABSOLUTE_VAULT }
    : ({ vault: ABSOLUTE_VAULT, author } as unknown as ProjectConfig);
}

async function writeRawConfig(root: string, raw: string): Promise<void> {
  await writeFile(path.join(root, PROJECT_CONFIG_FILENAME), raw, "utf8");
}

describe("EXAMPLE_CONFIG_CONTENT (design AD-3 pinned bytes)", () => {
  it("is the placeholder template: vault reference, no author anywhere", () => {
    expect(EXAMPLE_CONFIG_CONTENT).toBe(
      '{\n  "vault": "/absolute/path/to/your/vault"\n}\n',
    );
    expect(EXAMPLE_CONFIG_CONTENT).toContain("vault");
    expect(EXAMPLE_CONFIG_CONTENT).not.toContain("author");
    expect(EXAMPLE_CONFIG_FILENAME).toBe("supermemory.example.json");
  });
});

describe("findProjectRoot", () => {
  it("resolves the work-tree root when basePath is the root", async () => {
    const project = await makeProjectDir();
    try {
      expect(findProjectRoot(project.root)).toBe(project.root);
    } finally {
      await project.cleanup();
    }
  });

  it("resolves the root from a subdirectory (AD-1 discovery)", async () => {
    const project = await makeProjectDir({ nested: "packages/foo" });
    try {
      expect(project.subdir).toBeDefined();
      expect(findProjectRoot(project.subdir as string)).toBe(project.root);
    } finally {
      await project.cleanup();
    }
  });

  it("nested work trees: the nearest root wins", async () => {
    const project = await makeProjectDir({ nested: "inner/pkg" });
    try {
      const inner = path.join(project.root, "inner");
      await execFileAsync("git", ["init", "--quiet", inner]);
      expect(findProjectRoot(path.join(inner, "pkg"))).toBe(inner);
      expect(findProjectRoot(project.root)).toBe(project.root);
    } finally {
      await project.cleanup();
    }
  });

  it("no .git anywhere (never a work tree) → undefined", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-noroot-"));
    try {
      expect(findProjectRoot(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a .git FILE (linked-worktree shape) marks its root", async () => {
    const project = await makeProjectDir({ nested: "linked" });
    try {
      const linked = project.subdir as string;
      await writeFile(
        path.join(linked, ".git"),
        "gitdir: /somewhere/else/.git/worktrees/linked\n",
        "utf8",
      );
      expect(findProjectRoot(linked)).toBe(linked);
    } finally {
      await project.cleanup();
    }
  });
});

describe("projectConfigPath", () => {
  it("joins the work-tree root with supermemory.json", async () => {
    const project = await makeProjectDir();
    try {
      expect(projectConfigPath(project.root)).toBe(
        path.join(project.root, "supermemory.json"),
      );
    } finally {
      await project.cleanup();
    }
  });

  it("outside any work tree → undefined", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-nopath-"));
    try {
      expect(projectConfigPath(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadProjectConfig — fail-safe matrix (every malformed case ⇒ undefined, never throws)", () => {
  it("absent file → undefined", async () => {
    const project = await makeProjectDir();
    try {
      await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  it("outside any work tree → undefined", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-outside-"));
    try {
      await expect(loadProjectConfig(dir)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("unreadable file (EACCES) → undefined", async () => {
    const project = await makeProjectDir();
    try {
      const file = path.join(project.root, PROJECT_CONFIG_FILENAME);
      await writeRawConfig(project.root, JSON.stringify({ vault: ABSOLUTE_VAULT }));
      await chmod(file, 0o000);
      try {
        await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
      } finally {
        await chmod(file, 0o644); // let cleanup remove it
      }
    } finally {
      await project.cleanup();
    }
  });

  it("invalid JSON (truncated `{ \"vault\": `) → undefined", async () => {
    const project = await makeProjectDir();
    try {
      await writeRawConfig(project.root, '{ "vault": ');
      await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  it("non-object roots (string, number, null, array) → undefined", async () => {
    for (const raw of ['"just a string"', "42", "null", "[1, 2]"]) {
      const project = await makeProjectDir();
      try {
        await writeRawConfig(project.root, raw);
        await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
      } finally {
        await project.cleanup();
      }
    }
  });

  it("vault missing → undefined", async () => {
    const project = await makeProjectDir({
      config: { author: { name: "Raul", email: "raul@example.com" } },
    });
    try {
      await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  it("vault non-string → undefined", async () => {
    const project = await makeProjectDir({ config: { vault: 42 } });
    try {
      await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  it("vault relative (`../vaults/notes`) → undefined (non-absolute treated as unconfigured)", async () => {
    const project = await makeProjectDir({ config: { vault: "../vaults/notes" } });
    try {
      await expect(loadProjectConfig(project.root)).resolves.toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  it("author half-present → author dropped, vault still honored", async () => {
    const project = await makeProjectDir({
      config: { vault: ABSOLUTE_VAULT, author: { name: "Raul" } },
    });
    try {
      await expect(loadProjectConfig(project.root)).resolves.toEqual({
        vault: ABSOLUTE_VAULT,
      });
    } finally {
      await project.cleanup();
    }
  });

  it("unknown keys are ignored — the loaded shape stays flat", async () => {
    const project = await makeProjectDir({
      config: { vault: ABSOLUTE_VAULT, stale: true, extra: { nested: 1 } },
    });
    try {
      await expect(loadProjectConfig(project.root)).resolves.toEqual({
        vault: ABSOLUTE_VAULT,
      });
    } finally {
      await project.cleanup();
    }
  });

  it("happy path: flat vault + author loads as-is (spec: Happy-path save and read)", async () => {
    const project = await makeProjectDir({
      config: {
        vault: ABSOLUTE_VAULT,
        author: { name: "Raul", email: "raul@example.com" },
      },
    });
    try {
      await expect(loadProjectConfig(project.root)).resolves.toEqual({
        vault: ABSOLUTE_VAULT,
        author: { name: "Raul", email: "raul@example.com" },
      });
    } finally {
      await project.cleanup();
    }
  });
});

describe("projectAuthor", () => {
  it("both present → the author pair", () => {
    expect(
      projectAuthor({
        vault: ABSOLUTE_VAULT,
        author: { name: "Raul", email: "raul@example.com" },
      }),
    ).toEqual({ name: "Raul", email: "raul@example.com" });
  });

  it("absent author (and undefined config) → undefined", () => {
    expect(projectAuthor({ vault: ABSOLUTE_VAULT })).toBeUndefined();
    expect(projectAuthor(undefined)).toBeUndefined();
  });

  it("malformed (only one of name/email, or empty) → undefined", () => {
    expect(projectAuthor(configWithAuthor({ name: "Raul" }))).toBeUndefined();
    expect(projectAuthor(configWithAuthor({ email: "raul@example.com" }))).toBeUndefined();
    expect(projectAuthor(configWithAuthor({ name: "", email: "raul@example.com" }))).toBeUndefined();
    expect(projectAuthor(configWithAuthor({ name: "Raul", email: "" }))).toBeUndefined();
    expect(projectAuthor(configWithAuthor("not an object"))).toBeUndefined();
  });
});

describe("resolveVaultPath — the chain: flag → SUPERMEMORY_VAULT → project file → pinned error", () => {
  it("flag overrides env and file (spec: Flag overrides env and file)", async () => {
    const project = await makeProjectDir({ config: { vault: ABSOLUTE_VAULT } });
    try {
      await expect(
        resolveVaultPath({
          vaultFlag: "/Users/me/vaults/work",
          env: envWith({ SUPERMEMORY_VAULT: "/Users/me/vaults/personal" }),
          basePath: project.root,
        }),
      ).resolves.toBe("/Users/me/vaults/work");
    } finally {
      await project.cleanup();
    }
  });

  it("env overrides the project file (spec: Env overrides file)", async () => {
    const project = await makeProjectDir({ config: { vault: ABSOLUTE_VAULT } });
    try {
      await expect(
        resolveVaultPath({
          env: envWith({ SUPERMEMORY_VAULT: "/Users/me/vaults/personal" }),
          basePath: project.root,
        }),
      ).resolves.toBe("/Users/me/vaults/personal");
    } finally {
      await project.cleanup();
    }
  });

  it("project file is the last configured source (spec: Project file is the last configured source)", async () => {
    const project = await makeProjectDir({ config: { vault: ABSOLUTE_VAULT } });
    try {
      await expect(
        resolveVaultPath({ env: envWith({}), basePath: project.root }),
      ).resolves.toBe(ABSOLUTE_VAULT);
    } finally {
      await project.cleanup();
    }
  });

  it("nothing configured → AppError NO_VAULT_CONFIGURED with the byte-pinned message", async () => {
    const project = await makeProjectDir();
    try {
      const error = await resolveVaultPath({
        env: envWith({}),
        basePath: project.root,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe("NO_VAULT_CONFIGURED");
      expect((error as Error).message).toBe(
        "No vault configured. Run: supermemory setup",
      );
      // Design §4: the hint names both escape hatches.
      expect((error as { hint?: string }).hint).toContain("--vault");
      expect((error as { hint?: string }).hint).toContain("SUPERMEMORY_VAULT");
    } finally {
      await project.cleanup();
    }
  });

  it("corrupt file fails safe to unconfigured — the same pinned error, no parse crash", async () => {
    const project = await makeProjectDir();
    try {
      await writeRawConfig(project.root, '{ "vault": ');
      const error = await resolveVaultPath({
        env: envWith({}),
        basePath: project.root,
      }).catch((e: unknown) => e);
      expect((error as Error).message).toBe(
        "No vault configured. Run: supermemory setup",
      );
    } finally {
      await project.cleanup();
    }
  });

  it("relative vault in the file is treated as unconfigured — same pinned error", async () => {
    const project = await makeProjectDir({ config: { vault: "../vaults/notes" } });
    try {
      const error = await resolveVaultPath({
        env: envWith({}),
        basePath: project.root,
      }).catch((e: unknown) => e);
      expect((error as Error).message).toBe(
        "No vault configured. Run: supermemory setup",
      );
    } finally {
      await project.cleanup();
    }
  });
});

describe("pre-placed example bytes round-trip (fixture sanity for later slices)", () => {
  it("example survives untouched and reads back byte-identical", async () => {
    const committed = '{\n  "vault": "/team/placeholder"\n}\n';
    const project = await makeProjectDir({ example: committed });
    try {
      expect(await readFile(path.join(project.root, EXAMPLE_CONFIG_FILENAME), "utf8")).toBe(
        committed,
      );
    } finally {
      await project.cleanup();
    }
  });
});
