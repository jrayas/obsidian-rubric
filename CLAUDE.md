# Vault Schema (Obsidian plugin)

An Obsidian **desktop** plugin (macOS and Windows) that reads note schemas from YAML files in a vault folder (`_schema` by default) and uses them for property autocomplete, option pickers, validation, readable IDs, timestamps and schema migration. The single source of truth is `Vault Schema Plugin Specification for Claude Code.md` in the project root.

## Start of every session

1. Read `docs/README.md` (index) and `tracking/current.md` (where things stand).
2. **Load the available skills before writing or testing code**: `obsidian-plugin-dev` (conventions, lint, API rules) and `obsidian-cdp-debugging` (driving a real Obsidian). Summary in `docs/skills-summary.md`.
3. Keep `docs/` and `tracking/` updated as part of every task (progress ticked with date and time, `current.md` overwritten at task start and end, `log.md` appended, `docs/decisions.md` for any assumption).

## Folder structure

```
src/core/       pure TypeScript rules (no `obsidian` import) – unit tested
src/obsidian/   adapters to Obsidian (vault, UI, Properties area)
src/main.ts     plugin entry
schema-pack/    starter schema pack (YAML) + REFERENCE.md; embedded into main.js
tests/          Vitest tests and helpers
scripts/        cross-platform Node scripts (debug harness, vault builder, log helper)
docs/           all documentation        tracking/   live project state
dev/            scratch vaults (git-ignored)    .tools/   project-local Node (git-ignored)
```

## Commands (same on macOS and Windows; they are npm scripts)

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Test | `npm test` |
| Typecheck | `npm run typecheck` |
| Lint (ESLint + stylelint) | `npm run lint` |
| Build (production) | `npm run build` |
| Dev watch (set `VAULT_SCHEMA_DEV_DIR` to copy output into a vault's plugin folder) | `npm run dev` |
| Create the hand-test vault in `dev/testvault` (build first) | `npm run vault:create` |
| Real-app checks (builds, launches an isolated Obsidian, runs every check, stops) | `npm run e2e` (`-- --keep` leaves it running, `-- --only <text>` filters; needs Obsidian installed) |
| Performance sanity on a synthetic vault | `node scripts/perf.mjs 3000` |
| Launch isolated Obsidian | `npm run debug:launch` |
| Drive it | `npm run debug -- eval "<js>"` / `reload` / `console` / `screenshot [file]` / `stop` |
| Log a line | `node scripts/log.mjs "message"` |

If Node is not installed: this repo may carry a project-local Node in `.tools/node` (macOS/Linux, Apple silicon).
- bash/zsh: `export PATH="$PWD/.tools/node/bin:$PATH"`
- PowerShell: install Node 22+ or unzip a Windows Node build to `.tools\node` and run `$env:Path = "$PWD\.tools\node;$env:Path"`

Set an environment variable: bash/zsh `export NAME=value`; PowerShell `$env:NAME = "value"`. Obsidian binary override: `OBSIDIAN_BIN`.

## Conventions

- Rules live in `src/core` and must not import `obsidian`. Anything touching Obsidian internals is only in `src/obsidian/properties-layer.ts`.
- Behaviour comes from the schema files, never hard-coded type names, status values or tags.
- Notes are changed only through the write queue; only `modified` is stamped silently; never delete data (use `archived_fields`); never move files; never write `breadcrumb`.
- Paths: `path.join` in Node scripts; vault paths use `/` and `normalizePath` in Obsidian code. Keep each file's line endings.
- Obsidian lint rules apply: no `innerHTML`, no inline static styles (CSS classes in `styles.css`, prefix `vschema-`), no `console.log`, no global `app`, sentence-case UI text, no default hotkeys, no API newer than `minAppVersion` (1.13.7) without a `requireApiVersion` guard.
- British English in docs and UI text.
- Do not weaken tests to pass. If the spec and real Obsidian behaviour disagree, record it in `docs/decisions.md`, choose the most sensible option and continue.
- Commit after each task with a clear message; do not touch files outside the project folder; do not touch the user's own Obsidian (the harness uses an isolated profile in `dev/scratch`).

## Lessons recorded while building (read before changing code)

- **Do not run `eslint --fix` on `src/` or `tests/`.** It once renamed a field called `global` to `window` and re-introduced literal BOM characters. Fix lint by hand.
- Obsidian internals live in **one file**, `src/obsidian/properties-layer.ts`. Everything it touches is feature-detected and restored on uninstall. Do not use those internals anywhere else.
- Notes are written only through `WriteQueue`. `processFrontMatter` breaks CRLF files, so do not use it.
- Every approved fix is written with `editExact`/`textExact` from the text its preview was made from.
- The real-app suite is the source of truth for UI behaviour (hold, latch, autocomplete, prompts). Run it after any change to `src/obsidian/`. Synthetic CDP key events need `nativeVirtualKeyCode`; a programmatic `focus()` does not place a caret (select the contents before `Input.insertText`).
- Prompts run one at a time. A prompt left open in a test blocks every later one.
- Windows, Obsidian 1.13.7, the real breadcrumb plugin and real sync cannot be tested on the macOS dev machine; see `docs/release-checklist.md` for the manual steps.
- The e2e/debug scripts keep their scratch vault in the system temp folder (`VAULT_SCHEMA_SCRATCH` overrides). A scratch vault inside the project was once acted on by something outside the plugin (notes moved to `Inbox`, `breadcrumb: ""` added, even with the plugin disabled) because the developer's own Obsidian had it registered. If notes move unexpectedly, suspect another Obsidian with the vault open, not this plugin.
- Park the synthetic pointer before hold tests: a real pointer over the list keeps it open on release (correct behaviour).
- **Check what the UI shows, not only the file.** A pick that changes the file can still look unchanged (and be reverted on blur) because Obsidian does not redraw a focused Properties field. Real-app checks for the Properties area must assert the displayed text and that it survives leaving the field; click with real `Input.dispatchMouseEvent` presses when hit-testing matters, not `element.click()`.
- Never call `Page.bringToFront` in the suite and do not run GUI checks while the developer is testing by hand: it steals their keyboard and a real pointer disturbs the synthetic Option key.
