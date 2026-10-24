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

Rubric starts **off** on a fresh install, so you can write and change your schema without it touching a note. When the schema is ready, turn it on from the status bar, the settings page or the command **Toggle automation on or off**.

Requires Obsidian **1.13.7 or later** (desktop only). See [docs/user-guide.md](docs/user-guide.md) for details.

## Commands

| Command | What it does |
| --- | --- |
| Show all options for this property | Latches the option list for the focused property (assign a hotkey in Obsidian's Hotkeys settings); opens a picker window if the Properties-area features are off |
| Toggle automation on or off | The master switch. Rubric is **off** on a fresh install so you can write your schema first; the status bar item does the same |
| Check vault | Runs the eleven checks and opens the report |
| Reload schemas | Reads the schema files again (use after editing a hidden `.schema` folder) |
| Open schema folder | Shows the schema folder in Finder or Explorer |
| Choose schema for this note | Asks which schema a note should use |
| Convert this note to another type | Preview, then convert; old values are kept in `archived_fields` |
| Create note from schema | Creates a note with an ID, `created` and every default |
| Install starter schema pack | Creates the starter schema files that are missing |

No command has a default hotkey.

## Starter schema

The starter pack has eight everyday types (note, kb, project, exercise, journal, person, resource, task) and an opt-in **lesson** type that uses the `curriculum` (domain, section, level, order, track) and `verification` modules and a `tracks` vocabulary. It ships a ready-made `maths` domain as an example of the overrides below; delete it or copy it for your own domain.

## Domain overrides

A new domain (maths, physics, biology…) can change the defaults without forking the schema. Next to a default file, an optional folder named after it holds one override file per domain, named by the domain slug:

```
_schema/types/kb.yaml                      default
_schema/types/kb/maths.yaml                override for kb notes whose domain is maths
_schema/modules/verification/maths.yaml    override for a module
_schema/vocabularies/tags/maths.yaml       extra tags for maths
_schema/vocabularies/tracks/maths.yaml     extra tracks for maths
```

The effective schema for a note is the default plus the override file for the note's `domain` property. No override file means the default applies, so a vault without override folders behaves exactly as before. The `domain` values come from the schema's own `domain` property; a file for a domain that is not one of them is an error. The file name is the slug, and the file must say `domain: <slug>` too.

**Type and module files** have three verbs, nothing else (no inheritance, no archetypes):

```yaml
domain: maths
override:            # change values, default or description of an existing property
  kind:
    values: [definition, theorem, proof]
    default: definition
add:                 # properties allowed only for this domain (full property definitions)
  prerequisite_theorems: {type: list, items: link}
remove: [standards]  # properties not allowed for this domain
sections: [maths-algebra, maths-analysis]   # module files only: added to the module's `section` values
```

- A **type** file may name any property of the type. A **module** file may only name properties of that module, and applies to every type that uses the module. Module files apply first, then the type file.
- `override` replaces `values` (the domain's list, not an addition); only `values`, `default` and `description` can change, and `values` only on an enum. Changing `type` is an error, as is any other key.
- `add` puts the property after the type's own properties and before `created` and `modified`. A name the type already has is an error.
- `remove` of a name the type does not have is an error. One property cannot appear under two verbs in one file.
- **Core properties cannot be removed:** `type`, `schema`, `id`, `name`, `status`, `domain`, `section`, `level`, `order`, `created`, `modified`.
- `sections` extends the default `section` list with the domain's own. Every `section` value and every `track` term for a domain starts with `<domain>-`.
- **Vocabulary files** are `domain:` plus `terms:`, in the same shape as the default vocabulary. The domain's terms are added to the default ones. A term or synonym that equals a default term or synonym is an error and the default wins. The "Add to vocabulary" fix writes into the domain's file when it has one.
- Added properties are checked like any other: one value type per property name across every type and every domain.

A note is checked against its domain's effective schema: values, required properties, options and autocomplete, tag synonyms. The vault check also reports a `section` or `track` that does not start with the note's domain, and a property the domain removed that is still present (reported only, never deleted).

The existing `overrides:` key in a type file is a different thing and is unchanged: it adjusts a module property for that type in every domain (`values`, `default`, `required`). Domain overrides live in their own files so a type file never has to name a domain.

The same rules are enforced by the vault's `tools/validate.py` (`--domain <slug>` prints a domain's overrides and the effective properties per type). Tests: `npm test` (the engine) and `npm run test:validator` (the validator, against `tests/fixtures/domain-vault`).

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
