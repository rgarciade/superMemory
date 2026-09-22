# Troubleshooting

## FTS5 is missing (`SQLITE_FTS5_MISSING`) {#fts5}

At boot, supermemory probes SQLite for **FTS5** (full-text search). The
vault search index is built on FTS5 — without it, `find` cannot work, so
boot fails fast with:

```text
supermemory: SQLite on this machine was built without FTS5
(better-sqlite3 <pkg-version>, SQLite <sqlite-version>).
```

### Why this happens

The `better-sqlite3` npm package ships **prebuilt binaries that include
FTS5** for common platforms (darwin-arm64, darwin-x64, linux-x64,
linuxmusl-x64, win32-x64) and bundles them inside the package. A missing
FTS5 almost always means one of:

1. The prebuild for your platform was skipped and the module was compiled
   from source against a **custom SQLite** without the `SQLITE_ENABLE_FTS5`
   build flag.
2. A system SQLite was picked up (e.g. via `SQLITE_PATH` or a distro
   patch) that lacks FTS5.
3. An old cached build of `better-sqlite3` predating bundled prebuilds.

### Fix — rebuild the native module from source

```bash
npm rebuild better-sqlite3 --build-from-source
```

Building from source requires a C compiler and Python toolchain:

- **macOS**: `xcode-select --install` (clang + make), plus Python 3.
- **Debian/Ubuntu**: `sudo apt install build-essential python3`.
- **Alpine** (linuxmusl): `sudo apk add build-base python3`.
- **Windows**: the windows-build-tools / Visual Studio Build Tools with
  the C++ workload, plus Python 3.

Rebuilding from source compiles the SQLite amalgamation bundled **with**
`better-sqlite3`, which enables FTS5 — this resolves the custom-SQLite
problem in the same step.

### Diagnosing a custom SQLite pickup

If you set `SQLITE_PATH` (or a dependency pulled a system SQLite), check:

```bash
node -e "const D=require('better-sqlite3');const d=new D(':memory:');console.log(d.prepare('select sqlite_version()').get());d.close()"
```

- If this fails with FTS5 missing while `npm rebuild` reports success,
  inspect `node_modules/better-sqlite3/build/Release/` — the `.node`
  binary there should be the freshly built one.
- Remove any `SQLITE_PATH` env override and reinstall:
  `npm uninstall better-sqlite3 && npm install better-sqlite3`.

### How the boot probe reports it

`supermemory serve` runs the probe after vault validation and before the
index opens; on failure it prints the message above and exits — no tool
that depends on full-text search is served against a broken index. The
same probe runs as part of the test suite on Node LTS.
