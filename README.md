# Rubric

An Obsidian **desktop** plugin (macOS and Windows) that reads note schemas from plain YAML files in your vault and uses them for property autocomplete, option pickers, validation, readable IDs, timestamps and schema migration.

Schemas are text files in a folder (`_schema` by default). Each note type is a list of reusable modules plus its own fields. Add a type, a status value or a tag by editing a file: no code change, no restart.

It is described as **governance-ready**, not as a compliance system: locks are advisory, and real audit history needs git or backups.

## What it does

- **Matching.** Each note is matched to a schema: a valid `type` property, then the first segment of `breadcrumb`, then the folder name, otherwise it asks once and remembers. Include and exclude rules decide which notes are managed; the schema folder is always excluded.
- **Properties area.** Click a property and type: autocomplete from that note's schema (synonyms resolve to the preferred term). Hold **Option** (Alt on Windows) to show every allowed value, or press a hotkey to latch the list open (Escape or the same hotkey closes it). Locked properties show who manages them. A ▾ button opens the same list for mouse and screen-reader users.
- **Readable IDs.** `KB-2026-0143`: type prefix, creation year, running number. No counter file; the next number is worked out from your notes.
- **Timestamps.** `created` and `modified` are real frontmatter fields, always last, local time `YYYY-MM-DDTHH:mm`. `modified` follows any change to the note (including changes that arrive through sync) and ignores moves, breadcrumb rewrites and the plugin's own writes. By default it is the only thing written without asking; optional settings can fill new notes, keep `name` in step with the file name, and write `breadcrumb` from the folder.
- **Controlled tags, statuses and types.** Synonyms are replaced after you approve; unknown tags can be added to the vocabulary in one click; an invalid status offers the allowed values; changing a note's type shows a preview and keeps old values in `archived_fields` (nothing is ever deleted).
- **Property preview.** `_schema/preview/<type>.yaml` shows, read-only and always current, what a new note of each type starts with and what each property allows.
- **Vault check.** One report with eleven checks (missing properties, bad values, IDs, tags, names, breadcrumbs, old schema versions, leftover `domain`, timestamps, folder case clashes, schema problems). Every fix shows exactly what it will write and waits for you.
- **Migration.** Schema 1 → 2 with a diff: old IDs to the year format, nested blocks to flat properties, `domain` removed when it repeats the breadcrumb; anything that would be lost goes to `archived_fields`.

## Install

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](https://github.com/jrayas/obsidian-rubric/releases) (or build them: see Development).
2. Copy them to `<your vault>/.obsidian/plugins/rubric/` and enable **Rubric** in *Settings → Community plugins*.
3. Run the command **Install starter schema pack** to create `_schema/` with the starter types (it never overwrites existing files).

Requires Obsidian **1.13.7 or later** (desktop only). See [docs/user-guide.md](docs/user-guide.md) for details.

## Commands

| Command | What it does |
| --- | --- |
| Show all options for this property | Latches the option list for the focused property (assign a hotkey in Obsidian's Hotkeys settings); opens a picker window if the Properties-area features are off |
| Check vault | Runs the eleven checks and opens the report |
| Reload schemas | Reads the schema files again (use after editing a hidden `.schema` folder) |
| Open schema folder | Shows the schema folder in Finder or Explorer |
| Choose schema for this note | Asks which schema a note should use |
| Convert this note to another type | Preview, then convert; old values are kept in `archived_fields` |
| Create note from schema | Creates a note with an ID, `created` and every default |
| Install starter schema pack | Creates the starter schema files that are missing |

No command has a default hotkey.

## Privacy and network use

None. The plugin makes no network requests, collects no telemetry, needs no account, and reads and writes only files inside your vault. It stores its settings and a small index of known IDs in its own `data.json`.

## Things to know

- Locked and immutable properties are advisory: another tool can still change them. The vault check reports it.
- The Properties-area features use undocumented Obsidian internals (the same technique other community plugins use). They are feature-detected and fall back to commands and a picker window, with one notice, if Obsidian changes. A **Commands only** setting turns them off.
- Comments inside a note's frontmatter may be lost when the plugin rewrites it; explanations belong in the schema files.
- The plugin never writes `breadcrumb` and never moves files; those belong to your breadcrumb plugin.
- Not tested: Windows, Obsidian 1.13.7 (only 1.14.4 was available), the real breadcrumb plugin, real sync between two machines. See [docs/testing.md](docs/testing.md).

## Development

```
npm install
npm test          # unit tests
npm run lint      # ESLint with the Obsidian rules, and stylelint on styles.css
npm run build     # production build: main.js
npm run e2e       # real Obsidian, isolated profile (needs Obsidian installed)
```

Documentation for contributors is in [docs/README.md](docs/README.md). Licence: [MIT](LICENSE).
