# Current

**Updated (automation settings added):** 2026-10-21 01:44 — **Project complete.** Every item in `docs/plan.md` is done (see `tracking/progress.md`), all tests pass and the build succeeds.

## Final summary

### What was built
An Obsidian desktop plugin, **Rubric** (`rubric`, version 0.1.0, minimum Obsidian 1.13.7, desktop only), in TypeScript with a pure rules core (`src/core`) and thin Obsidian adapters (`src/obsidian`). It does everything in the spec's first-version list:

- Schema folder (`_schema`, `.schema` or custom, hidden folders read by polling), a starter pack of eight types / six modules / a tags vocabulary, validation with file and line, last-good-copy and hot reload.
- Matching (type, breadcrumb, folder, ask; three modes), scope, folder mapping written back with comments kept, the no-match prompt, a declarative settings page.
- Properties area: typed autocomplete, hold Option/Alt, latched hotkey, ▾ button, hint, lock notes, picker window, Source-mode suggest, a feature-detected layer with a "commands only" fallback.
- Write queue (compare first, own writer that keeps CRLF, order, exact-base writes), IDs, create-from-schema, the `modified` stamper with loop guard, tag/status/type-change prompts with previews and `archived_fields`.
- Vault check (eleven checks, report window, exact previews), schema 1→2 migration, batch mode with progress, newer-schema notes read-only.

### What was tested
- **255 unit tests** (Vitest): every rule in the spec, the eleven checks, migration, timestamps, IDs, the hold/latch state machine, the frontmatter writer.
- **67 real-app checks** (`npm run e2e`) in an isolated Obsidian 1.14.4 on macOS using only the three release files; stable across repeated runs. They cover the spec's manual checklist items 1–11, the definition-of-done failure cases, CRLF preservation, and a 12-note folder reorganisation.
- Lint (ESLint with the Obsidian rules, stylelint), typecheck and production build are clean (0 warnings). Performance on 3,000 notes: onload 8 ms, no long tasks at startup, full check 0.7 s.

### For a human to review or run
1. **Windows was not tested** (no machine). Run the Windows items in `docs/release-checklist.md: Alt must not move focus to a menu bar (D-32 / U3), accent-name matching, illegal-name rejection.
2. **Obsidian 1.13.7 was not available**; only 1.14.4 was tested. The declared minimum comes from the spec and the Nested Frontmatter Properties plugin.
3. **The real breadcrumb plugin is not installed here.** Its behaviour is simulated by writing `breadcrumb`; open question 1 (a hook between the plugins) was answered as "read the property only".
4. **Real sync between two machines was not run** (checklist item 12). Sync is simulated by external writes; D-34 explains why prompts only run for open notes.
5. The Properties-area features use undocumented Obsidian internals (isolated in `src/obsidian/properties-layer.ts`). Re-run the checklist on each Obsidian release.
6. Decisions worth a look in `docs/decisions.md`: D-01 (autonomy over the spec's approval gates), D-05 and D-33 (the plugin writes the starter pack and one vocabulary term, which the spec's write list did not include), D-07 (own frontmatter writer because `processFrontMatter` breaks CRLF), D-34 (prompts only for open notes), D-38 (the extra "Create note from schema" command).
7. Licence is 0BSD and author "Joan Anthirayas" (D-12); change them if you prefer.
8. Not done by design (spec "Later"): mobile, a board layer, an in-app schema editor, compliance modules.

### Where to start
`docs/README.md` (index), `docs/user-guide.md`, `docs/release-checklist.md`, `CLAUDE.md`.

## Update: automation settings (requested after the first handover)

Added and tested (decisions D-48 to D-52, user guide section "New notes, renames and moves"):

- **When a note is created in a mapped folder**: Ask with a preview (default), Fill automatically, or Do nothing, with an adjustable wait so templates can finish.
- **Keep name in step with the file name** (on): follows a rename only when `name` was empty or filled by the plugin.
- **Set breadcrumb from the folder** (off): for people who do not use a breadcrumb plugin.
- **Ask about changes in** open notes or every note, and separate switches for tag, status and type-change prompts.
- 265 unit tests and 76 real-app checks pass, stable over repeated runs.

**Please look at:** while testing I found that notes created through Obsidian in `dev/scratch/vault` were being moved into an `Inbox` folder and given `breadcrumb: ""`, even with this plugin disabled. Your Obsidian lists that vault as open. It is not this plugin; it is most likely your own breadcrumb setup acting on a vault your Obsidian has open. The test scripts now use a scratch vault in the system temp folder.
