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
| `templates/<type>.md` | Optional starting body and values for new notes of that type (see Templates) |

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

## Templates

`templates/<type>.md` (for example `templates/kb.md`) is optional. When the plugin fills a new note of that type (fill automatically, ask with a preview, **Choose schema for this note**, or **Create note from schema**):

- the template's **body** is inserted only if the note's body is empty. A note that already has any text keeps it exactly;
- the template's **properties** (the frontmatter at the top of the template file) become starting values, but only for properties the note does not already have. They replace the schema defaults, never a value you or another template wrote.

A template's properties must be properties of that type and valid for it. These are set by the plugin and are ignored if a template sets them: `type`, `schema`, `id`, `created`, `modified`, `breadcrumb`, `archived_fields`. A bad template is reported as a warning with file and line, and the schema still loads; the offending value, or the whole template, is skipped.

Placeholders you can use in the body and in text values: `{{name}}` (the file name), `{{id}}`, `{{type}}`, `{{date}}` (YYYY-MM-DD), `{{datetime}}` (YYYY-MM-DDTHH:mm), `{{folder}}` (the note's folder). An unknown placeholder is left as written and reported as a warning.

Example `templates/project.md`:

```
---
priority: 3
---
## Goal

## Milestones
```

This is separate from Obsidian's own Templates plugin and from the vault's `Templates/` folder (which is excluded from the schema). Turn the feature off with **Insert the schema template into new notes** in the plugin settings.

## Built-in property

`archived_fields` is built in, locked and generated. When a note is converted to another type, values that no longer apply are never deleted: they are kept in `archived_fields` as entries with the old type, the date and the values.

## Limits worth knowing

- Locks are advisory. Nothing stops another tool changing a locked property; the vault check reports it.
- Comments inside a note's frontmatter may be lost when the plugin rewrites it. Put explanations here, in the schema files.
- `created` and `modified` use local time with no timezone, so the hour when clocks go back is ambiguous.
