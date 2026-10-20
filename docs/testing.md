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
| Build the dev vault | `npm run vault:create` |
| Launch isolated Obsidian | `npm run debug:launch` (add `-- --release` semantics: files come from the repo root) |
| Drive it | `npm run debug -- eval "<js>"`, `reload`, `console`, `screenshot [file]`, `status`, `stop` |
| Real-app checks | `npm run e2e` (builds, launches an isolated Obsidian, runs every check, stops; `-- --keep` leaves it running, `-- --only <text>` filters) |

If `node` is not installed, use the project-local one: macOS/Linux `export PATH="$PWD/.tools/node/bin:$PATH"`; Windows PowerShell `$env:Path = "$PWD\.tools\node;$env:Path"` (after unpacking a Windows Node zip there).

## Test files and what they cover

(Updated as phases land. See `tracking/log.md` for the last run.)

| File | Covers |
| --- | --- |
| `tests/helpers/` | Seeded notes, the in-memory `FileSource`, the pack loader used by all tests |
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
| `tests/options.test.ts` | Options come from the note's schema; synonyms; locked properties and their notes; picking and toggling |
| `tests/hold-state.test.ts` | The hold/latch state machine: delay, repeat, cancel on another key, pointer rule, Escape order, hotkey |
| `scripts/e2e.mjs` (real Obsidian) | 47 checks across Phases 1-4: pack install, last good copy, hidden folder polling, prompts, settings page, decorations, hold/latch/Escape, saves, autocomplete, hint, commands-only, source-mode suggest, create from schema, ID allocation, every `modified` rule, tag/status/convert prompts, one-off schema choice, no rewrite of unchanged notes |

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

## Not covered here (honest limits)

- Windows: Alt/menu-bar focus, accent-name matching across systems, illegal-character rejection on a Windows file system.
- Sync between two machines (item 12): the loop guard is unit-tested; real sync is not exercised.
- The real breadcrumb plugin.
- Obsidian 1.13.7 (only 1.14.4 available).
- Physical keyboard input (CDP key events are synthetic).
- Visual polish.
