# Architecture

## Shape

```
 schema-pack/ (YAML starter schema, copied into a vault by hand)
        │ embedded as text at build time
        ▼
 ┌────────────────────────── src/core (pure TypeScript, no `obsidian` import) ──────────────────────────┐
 │ yaml-util  schema-loader  schema-resolve  schema-validate  matcher  scope  ids  timestamps           │
 │ frontmatter (read / edit / order / EOL)  note-rules  tags  convert  migrate  vault-check  fs-names    │
 │ hold-state (Option/hotkey state machine)  prompt-policy                                               │
 └───────────────▲──────────────────────────────────────────────────────────────────────────────────────┘
                 │ plain data in, plain data out (ports: FileSource, NoteStore, Clock)
 ┌───────────────┴────────────────────── src/obsidian (adapters; imports `obsidian`) ────────────────────┐
 │ vault-source  schema-service  note-service  write-queue  modified-stamper  picker-modal  suggester     │
 │ properties-layer (the only file that touches Obsidian internals)  prompts  vault-check-view  settings  │
 └───────────────▲──────────────────────────────────────────────────────────────────────────────────────┘
                 │
              src/main.ts (wiring, commands, lifecycle)
```

The eight parts in the spec map to modules like this:

| Spec part | Core | Obsidian layer |
| --- | --- | --- |
| 1 Loader and validator | `schema-loader`, `schema-resolve`, `schema-validate` | `vault-source` (reads files, hidden folders), `schema-service` (hot reload, last good copy) |
| 2 Matcher and scope | `matcher`, `scope`, `normalise` | `note-service` (answers "which schema for this file") |
| 3 Autocomplete | `note-rules` (value options per property) | `suggester` (EditorSuggest in source mode), `properties-layer` (widget decorator) |
| 4 Option dropdown | `hold-state` | `picker-modal`, `properties-layer` |
| 5 Write queue | `frontmatter` (pure edit + order + EOL) | `write-queue` (per-note serialisation, own-write ledger) |
| 6 Prompts and vault check | `note-rules`, `tags`, `vault-check`, `prompt-policy` | `prompts`, `vault-check-view` |
| 7 Migration and diff | `convert`, `migrate`, diff builder in `vault-check` | same views |
| 8 Settings | settings model | `settings` (declarative `getSettingDefinitions()`) |

## Data model

- **Pack**: `{ format, minPluginVersion, modules, vocabularies, types, folders, scope, problems }` after loading. Property definitions use the attribute names from the spec (`type`, `items`, `required`, `default`, `values`, `min`, `max`, `pattern`, `vocabulary`, `strict`, `normalise`, `locked`, `immutable`, `generated`, `managed_by`, `position`, `allow_heading`) plus one addition, `values_from` (`type` or `registry`), for enums whose values come from the type or the registry (D-11).
- **Resolved type**: ordered list of property definitions: modules in `uses` order, then own `properties`, then the system property `archived_fields` (only present when used), then `created` and `modified` (`position: end`). A type's `overrides` block can change `values`, `default` or `required` of a module property (this is how `status` gets per-type values).
- **Note snapshot** (core input): `{ path, folder, frontmatter, body?, ctime, eol }`. The core never touches files.

## Schema files and formats

See `schema-pack/REFERENCE.md` (shipped to users too). Short version:

- `registry/types.yaml`: `format`, `min_plugin_version`, `modules`/`vocabularies` path maps, `types` map of `{file, prefix, version}`.
- `registry/folders.yaml`: `mode` (combined/auto/manual), `order` (fixed by the spec; checked), `folders` map of root folder to type.
- `registry/scope.yaml`: `mode` (`exclude`/`include-only`), `exclude`, `include`.
- `modules/*.yaml`: `module`, `properties` map.
- `vocabularies/tags.yaml`: `terms` map of preferred term to `{ synonyms: [...] }`.
- `types/*.yaml`: `type`, `uses`, `overrides`, `properties`.

## Data flow

1. **Startup** (`onLayoutReady`): find the schema folder, load the pack, publish to `schema-service`, start the watcher (vault events for a visible folder, 2 s `adapter.stat` polling for a hidden one), build note fingerprints in the background, install the Properties layer if allowed and detectable.
2. **Vault event** (`modify`/`rename`/`create`): `note-service` checks scope, resolves the schema, compares the fingerprint with the last one. `modified-stamper` decides whether to stamp (debounced). `rename` re-reads `breadcrumb` and, if the first segment now maps to another schema, queues the convert prompt.
3. **User opens a property**: `properties-layer` (or a command) asks `note-rules` for the options for `(schema, property, current value)`, shows the list, and on a pick sends one change to `write-queue`.
4. **Write**: `write-queue` serialises per path, reads the file in `vault.process`, runs the pure `frontmatter.edit()` (compare first, apply, order, keep EOL), returns the same text when nothing changed, records the new content hash in the own-write ledger, and writes once.
5. **Vault check / migration**: scan notes → list of `Finding`s each carrying an optional `Fix` (a pure `FrontmatterPatch`). The window shows the diff produced from that same patch, and applying it calls the write queue with that patch, so preview and write cannot differ.

## Key design decisions (reasons)

| Decision | Reason |
| --- | --- |
| Pure core, thin adapters | Every rule in the spec must be checkable; Vitest can test them in milliseconds without Obsidian. Real behaviour is covered by CDP runs |
| Own frontmatter writer inside `vault.process` | Phase 0 found `processFrontMatter` mixes line endings on CRLF files (U6). `vault.process` is atomic and gives one write per note. Uses the `yaml` Document API, which keeps untouched values' formatting |
| Decorate the stock widget instead of registering a new type | `getTypeInfo` has no file; a new type would be assigned per property name for all notes. Decorating keeps notes without a schema untouched and works with other plugins' widgets (D-09) |
| One file touches internals (`properties-layer.ts`) | The spec requires the undocumented part to sit behind one switch. Every internal access is feature-detected, failure triggers one notice and commands-only mode |
| Fingerprints and an own-write ledger | Obsidian gives no event source (U7). Content comparison is the fallback the spec names |
| Hold/latch as a state machine | The rules (delay, cancel on other key, pointer rule, Escape order) are easy to get subtly wrong; a pure machine can be tested exhaustively |
| Declarative settings | `minAppVersion >= 1.13.0` so `display()` is not used |

## Files the plugin writes

- Notes: only through `write-queue`, only `modified` silently; everything else after approval.
- `registry/folders.yaml` and `registry/scope.yaml` (comments preserved) from the settings page and the no-match prompt.
- `preview/<type>.yaml` (generated, read-only), and a term added to a vocabulary file when you click *Add to vocabulary*. The plugin installs no schema: users copy `schema-pack/` into the schema folder themselves (D-68).
- `data.json` (plugin settings, remembered "not now" folders, the local index of known IDs and first-seen creation times).

## Platform notes

The code uses `Platform.isMacOS` for the default hold key (`Alt` is the same DOM modifier on both systems; the Mac key is labelled Option). Folder names are compared lower-cased and Unicode-NFC/NFD-normalised with accents folded. File-name validation rejects characters illegal on either system. Paths use `normalizePath` inside Obsidian and forward slashes in vault paths; Node scripts use `path.join`.

## Modules as built

`src/core/` (pure, no `obsidian` import; unit tested)

| File | Job |
| --- | --- |
| `schema-types.ts`, `yaml-file.ts`, `semver.ts` | Data model, YAML with line numbers, version compare |
| `schema-loader.ts` | Load and validate the pack; problems name file and line |
| `folder-detect.ts`, `normalise.ts` | `_schema`/`.schema`/custom detection; case- and accent-insensitive names |
| `matcher.ts`, `scope.ts`, `prompt-policy.ts` | Rule 1 (modes combined/auto/manual), rule 2, when to ask |
| `registry-edit.ts` | Comment-preserving edits of `folders.yaml` and `scope.yaml` |
| `frontmatter.ts` | Read, edit (compare first), order, keep EOL and BOM, keep untouched formatting |
| `validate.ts`, `options.ts`, `hold-state.ts` | Value rules; option lists, autocomplete, lock notes; the hold/latch state machine |
| `ids.ts`, `timestamps.ts`, `hash.ts` | Rule 4, rule 5 and the fingerprint, content hash |
| `tags.ts`, `convert.ts`, `create.ts` | Rule 6, rule 8, creation and completion of a note |
| `migrate.ts`, `note-check.ts`, `preview.ts` | Schema 1 to 2; the eleven checks with previewed fixes; diff lines |
| `fs-names.ts` | File-name rules for macOS and Windows, case collisions |

`src/obsidian/` (adapters)

| File | Job |
| --- | --- |
| `vault-source.ts`, `schema-service.ts` | Read the schema folder (hidden too), hot reload, polling, last good copy |
| `registry-store.ts`, `vocabulary-store.ts` | The only schema-file writers |
| `note-service.ts`, `choice-modals.ts`, `settings-tab.ts` | Scope and matching for a file; the no-match prompt; the settings page |
| `write-queue.ts` | The only note writer: one queued write per note, `editExact`/`textExact`, own-write ledger, read-only guard for newer schemas |
| `option-list.ts`, `option-session.ts`, `picker-modal.ts`, `source-suggest.ts`, `target-property.ts` | The option list view, loading and saving a property's options, the picker window, Source-mode autocomplete |
| `properties-layer.ts` | **The only file that touches undocumented internals** (decorator, field controllers, native suggest muting) |
| `modified-stamper.ts`, `change-watcher.ts`, `known-index.ts`, `id-service.ts` | Stamping with the loop guard; tag/status/convert prompts and batch conversion; the first-seen index; ID allocation |
| `note-actions.ts`, `create-note.ts`, `preview-modal.ts`, `modals.ts` | Convert and complete a note; create from schema; previews and choices |
| `vault-check.ts`, `vault-check-view.ts` | Scan, apply fixes, the report window with batch migration |
| `main.ts` | Wiring, commands, lifecycle |
