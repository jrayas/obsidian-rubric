# Testing

## Strategy

Three layers, because the spec has pure rules and an undocumented UI hook:

1. **Unit tests (Vitest, `tests/`)**: every rule in the spec, against the pure core and seeded in-memory notes. These run in under a few seconds with no Obsidian. This is where rules 1 to 12, the eleven vault checks, migration, IDs and timestamps are proved.
2. **Real-app checks (CDP, `scripts/`)**: load the built plugin into an isolated Obsidian with a scratch vault, drive it (key events, clicks, commands), read console errors, take screenshots. Covers the Properties layer, modals, settings page, hot reload, hidden folders and the release files on their own. Evidence goes into `tracking/log.md`.
3. **Manual checklist**: the twelve items and three Windows items from the spec's test plan, run per Obsidian release (Mac recorded here; Windows left to a human).

Tests never get weakened to pass; a failing test is a bug in code or a recorded spec disagreement in `decisions.md`.

## How to run

| Task | Command (macOS and Windows) |
| --- | --- |
| All unit tests | `npm test` |
| Watch mode | `npm run test:watch` |
| Typecheck | `npm run typecheck` |
| Lint (ESLint with Obsidian rules + stylelint) | `npm run lint` |
| Production build | `npm run build` |
| Build the hand-test vault (`dev/testvault`: starter schema, built plugin, examples, a `Problems/` folder with one note per finding, `START HERE.md`; run `npm run build` first) | `npm run vault:create` (optional argument: another folder) |
| Launch isolated Obsidian | `npm run debug:launch` (add `-- --release` semantics: files come from the repo root) |
| Drive it | `npm run debug -- eval "<js>"`, `reload`, `console`, `screenshot [file]`, `status`, `stop` |
| Real-app checks | `npm run e2e` (builds, launches an isolated Obsidian, runs every check, stops; `-- --keep` leaves it running, `-- --only <text>` filters) |

If `node` is not installed, use the project-local one: macOS/Linux `export PATH="$PWD/.tools/node/bin:$PATH"`; Windows PowerShell `$env:Path = "$PWD\.tools\node;$env:Path"` (after unpacking a Windows Node zip there).

## Test files and what they cover

(Updated as phases land. See `tracking/log.md` for the last run.)

| File | Covers |
| --- | --- |
| `tests/helpers/` | Seeded notes, the in-memory `FileSource`, the pack loader used by all tests. The rule tests load the **frozen** pack in `tests/fixtures/rule-pack/`, not `schema-pack/`, so the shipping pack can change freely; the shipping pack has its own tests below |
| `tests/schema-pack.test.ts` | The shipped pack loads with zero problems; each type resolves to the spec's property list and order |
| `tests/schema-loader.test.ts` | Folder detection; invalid YAML, unknown module, bad enum default, property type conflict each reported with file (and line); last-good-copy |
| `tests/folder-detect.test.ts` | `_schema`, `.schema`, custom, both existing, not found |
| `tests/embedded-pack.test.ts` | The pack embedded in `main.js` is identical to `schema-pack/` and loads cleanly |
| `tests/matcher.test.ts` | Rule 1 branches, case and accent variants (NFC/NFD), two schemas on one folder, the three modes |
| `tests/prompt-policy.test.ts` | Ask once per folder; never for sync arrivals; manual command always asks |
| `tests/registry-edit.test.ts` | folders.yaml and scope.yaml edits keep comments; case and accent variants replaced |
| `tests/scope.test.ts` | Rule 2 |
| `tests/ids.test.ts` | Rule 4 |
| `tests/timestamps.test.ts` | Rule 5 including loop guard |
| `tests/tags.test.ts`, `tests/status.test.ts` | Rules 6 and 7 |
| `tests/convert.test.ts` | Rule 8 and `archived_fields` |
| `tests/frontmatter.test.ts` | Write queue core: unchanged → no write, order, LF and CRLF preserved |
| `tests/vault-check.test.ts` | Each of the eleven checks finds a seeded problem and writes nothing |
| `tests/migrate.test.ts` | Schema 1 → 2 diff exactness, flattening, batch mode |
| `tests/hold-state.test.ts` | Rule set for hold, latch, delay, cancel, pointer, Escape order |
| `tests/fs-names.test.ts` | Illegal characters, case-only folder collisions |
| `tests/ids.test.ts` | Rule 4: format, per type per year, new year restarts, retired IDs never reused, old IDs convert, duplicates (older keeps), several renumbered at once |
| `tests/timestamps.test.ts` | Rule 5: what changes the fingerprint (not modified or breadcrumb), every stamp decision, loop guard |
| `tests/validate.test.ts` | Value validation per type; file-name rules for macOS and Windows; case and accent collisions |
| `tests/tags.test.ts` | Rule 6: synonym replacement, unknown tags, duplicates, vocabulary add keeps comments |
| `tests/convert.test.ts` | Rule 8: preview, `archived_fields`, nothing deleted; note creation from every type |
| `tests/vault-check.test.ts` | The eleven checks each find a seeded problem; fixes resolve their own finding; the scan changes nothing; body tags; duplicates and allocation |
| `tests/migrate.test.ts` | Schema 1 to 2: IDs, every nested block, domain handling, archived values, created/modified last, no value lost |
| `tests/naming.test.ts` | Default note names in several languages; when a note is still being named |
| `tests/shipped-pack.test.ts` | The shipping pack: loads clean, the approved types, modules and domains, every example domain's overrides, and that a new note of every type in every domain is complete and valid |
| `tests/reference.test.ts` | `schema-pack/REFERENCE.md` names every type, module, vocabulary, domain, prefix, property, attribute and every schema problem and vault check code |
| `tests/test-vault.test.ts` | Builds the test vault, loads its schema and runs the vault check: every example is clean, every note in `Knowledge/Problems/` gives the finding it is named for |
| `tests/unique-id.test.ts` | The domain-level unique ID: format, scope, allocation, planning, archiving, conversion, schema prefixes, the vault check |
| `tests/switch.test.ts` | The master switch setting: off on a fresh install, on for saved settings from before it existed |
| `tests/schema-preview.test.ts` | The generated property preview: valid YAML, keys equal what a new note starts with, allowed values and ranges in comments, optional properties as comments, deterministic, follows schema changes |
| `tests/name-sync.test.ts` | `name` follows a rename only when plugin-filled; breadcrumb from a path; what to do with a new note in a mapped folder; the new settings' defaults and repair |
| `tests/options.test.ts` | Options come from the note's schema; synonyms; locked properties and their notes; picking and toggling |
| `tests/hold-state.test.ts` | The hold/latch state machine: delay, repeat, cancel on another key, pointer rule, Escape order, hotkey |
| `tests/note-text.test.ts` | Body access: split and join are byte exact (CRLF, BOM, no frontmatter, unclosed `---`, `---` in the body, frontmatter only, empty), plus 3000 random texts |
| `tests/note-sections.test.ts` | The heading tree and its extents, fences (longer closers, unclosed), math, comments, setext, 0-based file lines, list depth; matches Obsidian's metadata cache on `tests/fixtures/body/obsidian-headings.json` (recorded from the real app, D-82) |
| `tests/body-edit.test.ts` | Insert at a heading: each of the four positions, first and last section, empty section, CRLF and mixed endings, no final newline, empty text, missing and ambiguous heading, inside a fence |
| `tests/body-schema.test.ts` | The `body:` key: off when absent, opt-in per type, `body-unknown-key` warning, `body-shape` error with the last good copy kept, not read from a module, carried into domain types |
| `tests/body-gate.test.ts` | The gate's order of reasons; the two settings default to off |
| `tests/body-service.test.ts` | Reads never gated; frontmatter bytes kept; a write sees the body as it is now; stale `expectedBody` is a conflict; unchanged writes nothing; refusals touch nothing; debug log |
| `tests/body-handlers.test.ts` | Registry; claim, pass, first claim wins; switches, IME, several cursors, fences, math, comments, frontmatter; what a handler sees; insert-only unless `mayRewrite`; bad edits dropped; a throwing handler skipped |
| `scripts/e2e.mjs` (real Obsidian) | 91 checks across Phases 1-10 (Phase 8 `P8 …` are the seven body-access checks: the `body` key, Enter unchanged with no handler, the demo command, the heading tree against Obsidian's metadata cache, a handler's claim under every switch with one undo step, the file API, a write to an open note with unsaved typing). Earlier text: 86 checks across Phases 1-10 (the property-preview write is covered by unit tests only so far; the real-app suite has not been run since it was added): pack install, last good copy, hidden folder polling, prompts, settings page, decorations, hold/latch/Escape, saves, autocomplete, hint, commands-only, source-mode suggest, create from schema, ID allocation, every `modified` rule, tag/status/convert prompts, one-off schema choice, no rewrite of unchanged notes, the vault check window with a seeded problem per check, every fix, migration (single and batch), the local index, schema problems with file and line, a folder reorganisation of 12 notes processed once, 12 stamps with progress, fill/ask/nothing on create, template-style notes, the adjustable wait, name following renames, move + rename with breadcrumb and conversion, prompt scope and switches, Option-key robustness (lost release, pointer rules), what the row displays after a pick, filling only after the name is typed |

## Real-app checks that must pass before release

Recorded in `tracking/log.md` with command output and screenshot paths:

- Plugin loads with no console errors (manual item 1).
- Properties layer decorates a schema note and leaves a non-schema note alone (items 2, 3, 4, 5, 6).
- Commands-only mode switches the layer off (item 7).
- Edit a note → one `modified` stamp after the pause (item 8).
- Move a note → `modified` unchanged; first-segment change shows the convert prompt (item 9).
- Edit and break a schema file → reload and last-good-copy warning (item 10).
- Vault check on the seeded vault → results match (item 11).
- Release-files-only install in a clean vault.

## Manual checklist for the Mac run (spec test plan, twelve items)

Each item was run as an automated real-app check on macOS, Obsidian 1.14.4, using the production build and only the three release files. Evidence is the check named in `scripts/e2e.mjs` and the dated entries in `tracking/log.md`.

| # | Item | Result | Check |
| --- | --- | --- | --- |
| 1 | Loads with no console errors | Pass | "P1 plugin loads…", "no console errors during the whole run" |
| 2 | Click into a property: autocomplete shows schema values | Pass | "P3 typing in a property autocompletes…" |
| 3 | Hold Option: list after the delay, hides on release; a symbol does not open it | Pass | "P3 hold shows the list only after the delay…", "another key during the hold cancels it" |
| 4 | Latched hotkey: stays open; hotkey and Escape close it; first Escape closes only the list | Pass | "P3 latched list…", "first Escape closes only the list…" |
| 5 | Locked properties ignore Option and the hotkey and show their note | Pass | "P3 locked properties ignore the hold…" |
| 6 | Single pick saves and keeps the list open when latched; multi ticks save each change | Pass | "P6 latched single-choice pick…", "P3 latched list…" |
| 7 | Commands only turns the features off; commands still work | Pass | "P3 commands-only switches…" |
| 8 | Edit a note: `modified` updates once after the pause and not again | Pass | "P4 modified: an edit stamps once…", "a burst…" |
| 9 | Move: breadcrumb changes, `modified` does not, first-segment change shows the convert prompt | Pass (breadcrumb plugin simulated by writing the breadcrumb) | "P4 modified: a move, a breadcrumb-only change…", "P4 a move that changes the first breadcrumb segment…" |
| 10 | Edit a schema file: reload; break it: last good copy and a warning | Pass | "P1 a broken schema file keeps the last good copy…" |
| 11 | Vault check on the test vault matches the seeded problems | Pass | "P5 the vault check window finds a seeded problem for each check…" |
| 12 | Sync a changed note between two machines: no prompt, no `modified` bounce | **Simulated only**: a sync arrival is a file written from outside with a newer `modified` | "P4 modified: a change arriving with a newer modified…", "P6 a change arriving through sync while a stamp is pending…", "P2 notes arriving like sync… never prompt" |

Windows-specific checks (Alt and the menu bar, accent names across systems, an illegal file name on a Windows file system) were **not run**: no Windows machine. The file-name rule itself is unit-tested (`tests/validate.test.ts`).

## Definition of done: failure cases (spec)

| Case | Evidence |
| --- | --- |
| Breaking a schema file leaves notes safe | Last good copy stays; no note write happens on a schema error ("P1 a broken schema file…") |
| An Obsidian update removes the widget layer | "P6 an Obsidian update that removes the widget layer…": one notice, no console errors, commands and picker work |
| An error inside the layer | "P6 an error inside the layer switches it off once…" |
| A sync conflict | "P6 a change arriving through sync while a stamp is pending is accepted, not overwritten"; every write is atomic (`vault.process`) and refuses if the note changed since its preview |
| Clean install | The e2e vault contains only `main.js`, `manifest.json`, `styles.css` (+ `data.json`) |
| With the breadcrumb plugin absent | All checks run without it. **With it installed: not tested**; its writes are simulated |

## Performance (macOS, Obsidian 1.14.4, `node scripts/perf.mjs 3000`)

Synthetic vault of 3,000 managed notes (about 1.2 KB each) across four types. Measured 2026-10-21.

| Measure | Result |
| --- | --- |
| Plugin `onload` | 8 ms |
| Long main-thread tasks (over 50 ms) while loading and scanning in the background | none |
| Full vault check, 3,000 notes | 0.7 s; one 338 ms burst while the checks compute |
| Renderer memory | 297 MB before, 149 MB after startup, 206 MB after a check (noisy: Obsidian's own garbage collection dominates) |
| `data.json` | 301 KB (the first-seen index, 100 bytes per note) |

Not measured: vaults far above 3,000 notes, a vault on a network drive, Windows.

## Running the real-app suite

It drives a real Obsidian window. Leave the mouse and keyboard alone while it runs: a real pointer over the window sends events without the Option flag and the plugin reads them as a key release. Do not use `dev/testvault` for the suite or hand-test in a scratch vault the suite is using.

## Not covered here (honest limits)

- Windows: Alt/menu-bar focus, accent-name matching across systems, illegal-character rejection on a Windows file system.
- Sync between two machines (item 12): the loop guard is unit-tested; real sync is not exercised.
- The real breadcrumb plugin.
- Obsidian 1.13.7 (only 1.14.4 available).
- Physical keyboard input (CDP key events are synthetic).
- Visual polish.
