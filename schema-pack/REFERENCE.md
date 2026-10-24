# Schema reference

What every file and attribute in this folder means. The plugin reads these files, validates them when it loads them (naming the file and line of any problem) and reloads them when they change. If a file is invalid the plugin keeps using the last good copy and shows a warning.

Schema files are plain YAML. Edit them in any editor. The plugin writes only `registry/folders.yaml` and `registry/scope.yaml`, and only when you change a folder mapping or a scope rule in settings or answer the "no schema for this folder" prompt. Comments in those two files are kept.

## Folder layout

| Path | Purpose |
| --- | --- |
| `registry/types.yaml` | Format version, minimum plugin version, paths of modules and vocabularies, list of types with ID prefix and schema version |
| `registry/folders.yaml` | Matching mode and root folder → type mapping |
| `registry/scope.yaml` | Which notes are managed |
| `modules/*.yaml` | Reusable groups of properties |
| `vocabularies/*.yaml` | Controlled lists (tags) |
| `types/*.yaml` | A note type: the modules it uses plus its own properties |

## registry/types.yaml

| Key | Meaning |
| --- | --- |
| `format` | Version of this schema language. Currently `1`. A newer format than the plugin understands is refused (the last good copy stays in use) |
| `min_plugin_version` | Oldest plugin version that understands this pack |
| `modules` | Map of module name → file path (relative to the schema folder) |
| `vocabularies` | Map of vocabulary name → file path |
| `types` | Map of type name → `{ file, prefix, version }`. `prefix` is two capital letters used in IDs. `version` is the number written to `schema` in notes; a note with a lower number is offered a migration |

## registry/folders.yaml

| Key | Meaning |
| --- | --- |
| `mode` | `combined` (type, then breadcrumb, then folder name, then ask), `auto` (same without asking), `manual` (you choose per note or folder) |
| `order` | Documented, fixed: `type, breadcrumb, folder, ask`. Other values are reported and ignored |
| `folders` | Map of root folder name → type name. One type may have several folders. Names are compared ignoring case and accents |

If two types claim the same folder the plugin warns and asks which one owns it; it never picks silently.

## registry/scope.yaml

| Key | Meaning |
| --- | --- |
| `mode` | `exclude` (everything except `exclude`) or `include-only` (only `include`) |
| `exclude` | Folders that are not managed. Exclude always wins. The schema folder is always excluded and not listed |
| `include` | Folders that are managed in `include-only` mode |

An excluded note gets no suggestions, no picker, no validation, no automation and no prompts.

## Modules, vocabularies and types

A module file has `module` (its name), an optional `description`, and `properties`: a map of property name → attributes.

A type file has:

| Key | Meaning |
| --- | --- |
| `type` | The type name |
| `uses` | Module names in order. The note's property order is these modules in order, then the type's own `properties`, then `archived_fields` (if any), then `created` and `modified` |
| `overrides` | Changes to module properties for this type only. Used to give `status` its values and default. May change `values`, `default`, `required` |
| `properties` | The type's own properties |

A vocabulary file has `vocabulary` (its name) and `terms`: a map of preferred term → `{ synonyms: [...] }`.

## Property attributes

| Attribute | Applies to | Meaning |
| --- | --- | --- |
| `type` | all | Value type: `string`, `integer`, `boolean`, `date` (`YYYY-MM-DD`), `datetime` (`YYYY-MM-DDTHH:mm`, local time, no timezone), `url`, `link` (a quoted wiki-link `"[[Note]]"`), `enum`, `list` |
| `items` | `list` | Item type: `string`, `link`, `url` or `term` (a controlled term; needs `vocabulary`) |
| `required` | all | Must be present |
| `default` | all | Value used when a note is created. `today` is allowed for `date`. A property is written at creation when it is `required` or has a `default` |
| `values` | `enum` | Allowed values, in menu order |
| `values_from` | `enum` | `type` = the values come from the type's `overrides` (used by `status`); `registry` = the values are the type names (used by `type`) |
| `min`, `max` | `integer` | Limits |
| `pattern` | `string` | A regular expression the value must match |
| `vocabulary` | `list` of `term` | Name of the controlled list |
| `strict` | controlled | Unknown terms are flagged |
| `normalise` | controlled | Synonyms are replaced by the preferred term |
| `locked` | all | Never opens a picker in the Properties area; a short note says who manages it |
| `immutable` | all | Never changes after it is first written; changes are reported by the vault check |
| `generated` | all | The plugin fills it in |
| `managed_by: external` | all | Another plugin writes it (for example `breadcrumb`); this plugin only reads and checks it |
| `position: end` | all | Always sorts after every other property |
| `allow_heading` | `link` | The link may include a heading: `"[[Note#Heading]]"` |
| `target` | `link`, list of `link` | Link suggestions are limited to notes of this type |
| `description` | all | Free text for people reading the file |

A property name must have the same value type (and item type) in every type, because Obsidian keeps one type per property name across the vault. Enum value lists may differ between types.

## Opt-in pieces: lessons, domains and verification

The eight everyday types (note, kb, project, exercise, journal, person, resource, task) do not use these. Add a module name to a type's `uses` to switch it on.

| Piece | What it is |
| --- | --- |
| `modules/curriculum.yaml` | `domain`, `section`, `level`, `topic`, `order`, `track`: where a note sits in a reading path. `domain` picks the override files below; every `section` value and `track` term starts with its domain and a hyphen |
| `modules/verification.yaml` | `ai_generated`, `generated_by`, `verified`, `verified_by`, `references`: an honest record of who wrote a note and whether a person has checked it |
| `vocabularies/tracks.yaml` | Named learning paths, every term starting with its domain |
| `types/lesson.yaml` | A teaching note (prefix LS, folder `Lessons`) that uses both modules. A new type starts at schema version 1 |
| `*/lesson/maths.yaml` and the other `maths.yaml` files | A ready-made example of a domain override (below): kinds that suit maths, one added property, one removed, extra sections, tags and tracks. Delete them, or copy and rename them for your own domain |

To add a domain: append its name to the `domain` values in `modules/curriculum.yaml`, then add only the override files it needs.

## Domain overrides

Next to a default file you can add a folder of the same name with one override file per domain, named by the domain: `types/kb.yaml` plus `types/kb/maths.yaml`, `modules/verification/maths.yaml`, `vocabularies/tags/maths.yaml`. A note whose `domain` is maths then uses the default plus that file; a note in a domain with no file uses the default. The file starts with `domain: maths` and may use `override` (change `values`, `default`, `description` of an existing property), `add` (properties allowed only for this domain) and `remove` (properties not allowed). A module file may also have `sections: [...]`, added to the module's `section` values. Core properties (`type`, `schema`, `id`, `name`, `status`, `domain`, `section`, `level`, `order`, `created`, `modified`) cannot be removed; an override cannot change a property's type; `section` and `track` values start with `<domain>-`. Vocabulary override files hold `domain:` and `terms:`; a term equal to a default term or synonym is an error. See the README for the full rules.

## The preview folder

`preview/<type>.yaml` is written by the plugin, not by you. It shows what a new note of that type starts with (the properties in order with their starting values, and a comment after each saying what is allowed) and lists the properties that are not written until used. It is rewritten whenever the schema changes and is never read back, so editing it changes nothing: change the type and module files instead. It is ignored when the schema reloads. The setting **Write property previews to the schema folder** turns it off.

## Built-in property

`archived_fields` is built in, locked and generated. When a note is converted to another type, values that no longer apply are never deleted: they are kept in `archived_fields` as entries with the old type, the date and the values.

## Limits worth knowing

- Locks are advisory. Nothing stops another tool changing a locked property; the vault check reports it.
- Comments inside a note's frontmatter may be lost when the plugin rewrites it. Put explanations here, in the schema files.
- `created` and `modified` use local time with no timezone, so the hour when clocks go back is ambiguous.
