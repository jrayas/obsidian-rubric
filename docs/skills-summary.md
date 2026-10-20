# Skills summary

Skills were searched for in `.claude/skills/` (project), `~/.claude/skills/` (user) and the plugin skill list. Written 2026-10-20.

## Found

| Skill | Location | Used for |
| --- | --- | --- |
| `obsidian-plugin-dev` | `.claude/skills/obsidian-plugin-dev/` (+ five files in `reference/`) | Build, lint, manifest, API rules, review checklist |
| `obsidian-cdp-debugging` | `.claude/skills/obsidian-cdp-debugging/` | Running and testing the plugin in a real, isolated Obsidian |

`~/.claude/skills/` contains only a `synced` entry (no `SKILL.md` for this work). The other skills listed by the harness (design, pdf, docs, dataviz and so on) are unrelated to an Obsidian plugin and were not used.

## What was learned from `obsidian-plugin-dev`

- Users receive only `main.js`, `manifest.json`, optional `styles.css`. Everything else must be bundled. This is why the starter schema pack is embedded in `main.js` as text (see `decisions.md` D-05).
- Every API used must have `@since` at or below `minAppVersion` (here 1.13.7). Settings must use declarative `getSettingDefinitions()` because `minAppVersion >= 1.13.0`.
- Desktop-only plugins may use Node APIs; this plugin does not need them, but is still marked `isDesktopOnly: true` per the spec.
- Lint is `eslint-plugin-obsidianmd` (recommended) plus stylelint on `styles.css` with `--max-warnings 0`. Compatible versions: TypeScript 5.9.x, ESLint 9.39.x (not 10), typescript-eslint 8.71.x, esbuild 0.28.x. Known CSS flags: partial `text-decoration-*`, `column-gap`, duplicate declarations.
- Code rules enforced by lint: no `innerHTML`, no inline styles (use CSS classes and `setCssProps` for runtime values), no `console.log` (only `warn`/`error`/`debug`), no global `app`, no default hotkeys, sentence-case UI text, command ids and names must not contain the plugin id/name or the word "command", `vault.process` / `processFrontMatter` for background edits, `Platform` instead of `navigator`, no regex lookbehind, `requestUrl` instead of `fetch`.
- Lifecycle: register every event/DOM listener/interval through the `register*` helpers; keep `onload` cheap and do vault work in `workspace.onLayoutReady` (the `create` event fires for every file during load).
- Manifest rules: id lowercase with hyphens, no "obsidian", not ending in "plugin"; name without "Obsidian" or "Plugin"; description at most 250 characters, starts with a verb, ends with a full stop.
- Release: tag equals `manifest.version` with no `v`; sample GitHub Action builds and attaches the three files.
- Evidence discipline: say verified / secondary / unverified; never claim mobile works without a device or `emulateMobile`.

## What was learned from `obsidian-cdp-debugging`

- Always run a second isolated Obsidian with its own `--user-data-dir`, against a scratch copy of a vault; never attach to the user's everyday Obsidian or edit their `obsidian.json`.
- Launch with `--remote-debugging-port`, `--remote-allow-origins=*` and anti-throttling flags; pre-register the scratch vault in the scratch profile's `obsidian.json`; click "Trust author and enable plugins" through CDP.
- Drive the app with `Runtime.evaluate` (`awaitPromise`, `returnByValue`), `Input.dispatchKeyEvent`/`dispatchMouseEvent`, `Page.captureScreenshot`; read console and exceptions after every reload.
- Settings open in a separate window target with no `app` global; modals can mount in `activeDocument`; the native macOS menu is not in the DOM (`app.vault.setConfig('nativeMenus', false)` for tests).
- Test the shipped files by copying only the three release files into a fresh vault.
- The skill's own scripts (`scripts/`, `vault:synthetic`, etc.) belong to a different project (it mentions "foldwise"); they do not exist here. This project has its own minimal harness in `scripts/` that follows the same method (see `testing.md`).
- Limits to state honestly: real clipboard and OS-level input cannot be driven; mobile only emulated; Windows cannot be verified from macOS; visual polish needs a human.

## How the skills changed the plan

- Chose the pinned toolchain from the skill (TypeScript 5.9, ESLint 9) instead of the newest majors.
- Chose `vault.process` for writes after Phase 0 found `processFrontMatter` breaks CRLF (the skill recommends `vault.process`/`processFrontMatter` for background edits; either is allowed).
- Built a cross-platform Node harness rather than shell scripts, per the skill and the project requirements.
- Wrote docs in British English, as the skill asks and as the spec does.

## Instruction not followed

The CDP skill says to follow "the project's CLAUDE.md: propose scripts and wait for 'go' before writing code". There was no CLAUDE.md in this project, and the user's task brief explicitly says to work autonomously to completion, so the brief takes priority. Recorded as D-02 in `decisions.md`.
