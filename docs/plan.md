# Implementation plan

Source of truth: `Vault Schema Plugin Specification for Claude Code.md` (project root). This plan breaks its seven-phase work list into ordered tasks, each with a definition of done. Progress is ticked in `tracking/progress.md`.

## Approach in one paragraph

All rules live in a **pure TypeScript core** (`src/core/`) that never imports `obsidian`. It is unit-tested with Vitest against seeded in-memory notes. A thin **Obsidian layer** (`src/obsidian/`) adapts the vault, metadata cache, commands, modals and the Properties area to that core. The undocumented Properties-area widget technique is isolated in one file (`src/obsidian/properties-layer.ts`) that can be switched off. Real behaviour is verified in an isolated Obsidian driven over the Chrome DevTools Protocol (`scripts/`). See `architecture.md` for the reasons.

## Risks (from the spec, with what this plan does about each)

| Risk | Plan |
| --- | --- |
| Properties-area hooks undocumented | Phase 0 probes them in a real vault; isolated in one file; feature-detected; commands-only fallback tested |
| `processFrontMatter` mangles CRLF files (found in Phase 0) | Own frontmatter writer inside `vault.process`, unit-tested for EOL and order. See `decisions.md` D-07 |
| Cannot tell a sync arrival from a local edit by event | Content fingerprints and an own-write ledger; see `decisions.md` D-08 |
| Windows cannot be tested from this Mac | Everything platform-specific is a setting or a pure function; Windows items are written up as a manual checklist and called out in the final summary |
| Breadcrumb plugin not available here | Contract-only integration (read the `breadcrumb` property); tested with simulated breadcrumb writes |
| Schema language cost | Small attribute set, `REFERENCE.md` shipped with the pack, validation with file and line |
| Scope creep | Only the spec's first-version list; "Later" items are not built |

## Phases

Each task has an ID used in `tracking/progress.md`. "Done when" is copied from or tightened from the spec.

### Phase 0: plan and study

| ID | Task | Done when |
| --- | --- | --- |
| P0.1 | Read the spec; write this plan | `docs/plan.md` exists and is linked |
| P0.2 | Read skills; write `docs/skills-summary.md` | Both skills summarised |
| P0.3 | Scaffold: package.json, tsconfig, esbuild, eslint (Obsidian rules), stylelint, vitest, manifest, git | `npm run build`, `lint`, `test` run (even on an empty plugin) |
| P0.4 | Debug harness: launch isolated Obsidian, drive it over CDP | `npm run debug:launch` then `npm run debug -- eval` works |
| P0.5 | Study Better Properties and Nested Frontmatter Properties | `docs/research.md` says what exists, what to reuse, what is still needed |
| P0.6 | Try every unknown from spec section 14 in a real vault | `docs/unknowns.md` has a result for each: works / fails / works with a limit |
| P0.7 | Choose structure, tooling and test approach | Written in `architecture.md` and `testing.md`, with reasons |

### Phase 1: schema foundation

| ID | Task | Done when |
| --- | --- | --- |
| P1.1 | Write the schema pack (`schema-pack/`): registry, six modules, tags vocabulary, eight types, `REFERENCE.md` | Every file exists and parses; a test loads the pack |
| P1.2 | Detect the schema folder (`_schema`, `.schema`, custom); warn when both exist | Tests for each case |
| P1.3 | Load registry, modules, vocabularies, types; resolve each type (modules in order, own fields, `created`/`modified` last) | Each type resolves to the property list in spec section 5 (test per type) |
| P1.4 | Validate on load: YAML, unknown modules, unknown value types, enum defaults, property type conflicts | A bad file gives a message naming the file and line (test per error class) |
| P1.5 | Last good copy on error; hot reload (events, and polling for hidden folders); "Reload schemas" command | Breaking then fixing a file in a real vault restores without restart (CDP evidence) |
| P1.6 | Plugin shell: `main.ts`, settings storage, status notice | Plugin loads with no console errors in the isolated Obsidian |

### Phase 2: matching and scope

| ID | Task | Done when |
| --- | --- | --- |
| P2.1 | Matching order with case and accent normalisation | One test per branch of rule 1, plus case/accent variants |
| P2.2 | Scope: exclude, include-only, exclude wins, schema folder always excluded | Tests; excluded notes get nothing (checked at each feature entry point) |
| P2.3 | Folder mapping read/write in `registry/folders.yaml`; conflict warning | Remembering a mapping writes the file and keeps comments; conflict warns |
| P2.4 | No-match prompt with remember and "Not now"; never for sync arrivals; once per folder | Test of the prompt policy; CDP check of the modal |
| P2.5 | Settings page (all settings from spec section 9) | Matches the layout; values persist across reload |

### Phase 3: Properties area

| ID | Task | Done when |
| --- | --- | --- |
| P3.1 | Commands and picker modal (single and multi-select) | Works with the Properties layer disabled |
| P3.2 | Source-mode autocomplete through `EditorSuggest` | Suggests schema values, resolves synonyms |
| P3.3 | Widget decorator layer with feature detection and quiet fallback; "commands only" setting | Disabled cleanly if internals are missing (simulated); setting works |
| P3.4 | Hold Option/Alt shows all options after the delay; release rules; cancel on another key | Behaviour tests on a pure state machine plus CDP key-event check |
| P3.5 | Latched hotkey; Escape order | State-machine tests plus CDP check |
| P3.6 | Locked properties never open a list and show who manages them | Test for each of the six locked names |
| P3.7 | Focus hint and the `▾` button, keyboard and screen-reader usable | Present in the DOM with ARIA; CDP check |

### Phase 4: writes and automation

Note: P4.1 was built during Phase 3 (picks must save); see `decisions.md` D-30.

| ID | Task | Done when |
| --- | --- | --- |
| P4.1 | Write queue: one per note, compare-first, one write, order check, own-write marking | No loops; unchanged notes not rewritten; CRLF kept |
| P4.2 | Create a note from a type: ID, `created`, defaults, status; reject illegal file-name characters | New notes have all required properties |
| P4.3 | ID rules: format, year, per-type numbering, duplicate detection, two notes created at once | Rule 4 tests pass |
| P4.4 | Stamp `modified` with loop guard and ignore list | Rule 5 tests pass, including sync arrival with newer value |
| P4.5 | Tag synonym and unknown-tag prompts; one-click vocabulary add | Rule 6 tests pass |
| P4.6 | Status prompt for invalid values | Rule 7 tests pass |
| P4.7 | Convert-type prompt with `archived_fields` | Rule 8 tests pass; nothing deleted |

### Phase 5: vault check and migration

| ID | Task | Done when |
| --- | --- | --- |
| P5.1 | Vault check, all eleven checks, report window | Each check finds a seeded problem; nothing written without approval |
| P5.2 | Diff preview and approval flow for every fix | The preview equals what is written (test compares the two) |
| P5.3 | Migration schema 1 to 2, one note or all of a type | Every step of spec section 8 works; originals kept in `archived_fields` where flattening loses data |
| P5.4 | Batch mode with progress | A folder rename of many notes is processed once |

### Phase 6: hardening and release

| ID | Task | Done when |
| --- | --- | --- |
| P6.1 | Run the test plan; manual checklist on Mac; Windows items written up | Automated tests green; Mac checklist recorded in `tracking/log.md`; Windows limits recorded |
| P6.2 | Minimum Obsidian version and desktop-only in the manifest with the reason | In `manifest.json` and `docs/` |
| P6.3 | User documentation and release checklist | `docs/user-guide.md`, `docs/release-checklist.md` |
| P6.4 | Package; install in a clean vault using only the three release files | CDP run with only `main.js`, `manifest.json`, `styles.css` loads the pack and works with and without a breadcrumb plugin |

## Order of work and commits

Tasks are done in the order above. After each task (or tight group of tasks): run tests, typecheck and lint; fix failures; update `tracking/`; commit. Phase boundaries are demonstrated in `tracking/log.md` with the test output and real-vault evidence.

## Out of scope (not built)

Mobile, a kanban/board layer, an in-app schema editor, compliance modules, writing `breadcrumb`, moving files, timezone-aware timestamps, history/audit module.
