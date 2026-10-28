# Rubric schema reference

Everything about the schema files in one place, so you can look things up quickly. The plugin reads these files, validates them when it loads them (naming the file and line of any problem) and reloads them when they change. If a file is invalid the plugin keeps using the last good copy and shows a warning, and no note is changed because of a broken schema.

Schema files are plain YAML. Edit them in any editor.

**Contents:** [Cheat sheet](#cheat-sheet) · [Folder layout](#folder-layout) · [Who writes what](#who-writes-what) · [Registry files](#registry-files) · [Modules, types, vocabularies](#modules-types-and-vocabularies) · [Value types](#value-types) · [Property attributes](#property-attributes) · [Property order](#property-order) · [Built-in and locked properties](#built-in-and-locked-properties) · [IDs](#ids) · [Domains and overrides](#domains-and-overrides) · [The shipped pack](#the-shipped-pack) · [How a note finds its schema](#how-a-note-finds-its-schema) · [What the plugin does](#what-the-plugin-does) · [Presets and export](#schema-presets-and-export) · [Body access](#body-access) · [Vault check](#vault-check) · [Problem codes](#schema-problem-codes) · [Recipes](#recipes) · [Limits](#limits-worth-knowing)

## Cheat sheet

```
_schema/
  registry/  types.yaml  domains.yaml  folders.yaml  scope.yaml
                                                      what exists, the domains, which folder is which type, which notes count
  modules/   <module>.yaml                            reusable groups of properties
             <module>/<domain>.yaml                   a domain's changes to a module
  types/     <type>.yaml                              a note type = modules + its own properties
             <type>/<domain>.yaml                     a domain's changes to a type
  vocabularies/ <name>.yaml                           controlled lists (tags, tracks)
             <name>/<domain>.yaml                     a domain's extra terms
  preview/   <type>.yaml  <type>/<domain>.yaml        generated, read-only: what a new note starts with
  REFERENCE.md                                        this file
```

A property:

```yaml
status:
  type: enum                 # string integer boolean date datetime url link enum list
  values: [draft, review]    # enum only
  default: draft             # written when a note is created
  required: true             # must be present
  description: Where the note is in its life.
```

A type (note the three parts: modules, status, own properties):

```yaml
type: kb
uses: [base, findability, relations, curriculum]   # order = property order
overrides:                                         # tune a module property for this type
  status: { values: [draft, review, published], default: draft }
properties:                                        # the type's own
  kind: { type: enum, values: [concept, how-to], default: concept }
```

A domain override (`types/kb/maths.yaml`):

```yaml
domain: maths
override: { kind: { values: [definition, theorem], default: definition } }   # change an existing property
add:      { prerequisite_theorems: { type: list, items: link } }              # allowed only here
remove:   [audience]                                                          # not allowed here
```

| I want to… | Do this |
| --- | --- |
| Add a status value | Append it to `overrides.status.values` in the type file. Never rename or remove one |
| Add a tag | Add a term under `terms:` in `vocabularies/tags.yaml` (or the domain's tags file) |
| Add a property to one type | Put it under `properties:` in the type file |
| Add a property to many types | Put it in a module and list the module under `uses:` |
| Add a domain | One line in `registry/domains.yaml`, then override files only where it differs |
| Make a property required | `required: true`, ideally with a `default:` so new notes are complete |
| Lock a value the plugin sets | `locked: true`, `generated: true` |
| See what a new note looks like | Open `preview/<type>.yaml` (or `preview/<type>/<domain>.yaml`) |

## Folder layout

| Path | Purpose |
| --- | --- |
| `registry/types.yaml` | Format version, minimum plugin version, pack version, paths of modules and vocabularies, the list of types with ID prefix and schema version |
| `registry/domains.yaml` | The knowledge domains, registered like types: prefix, folder name and description of each, and the default |
| `registry/folders.yaml` | Matching mode and root folder → type mapping |
| `registry/scope.yaml` | Which notes are managed |
| `modules/*.yaml` | Reusable groups of properties |
| `modules/<module>/<domain>.yaml` | A domain's `override` / `add` / `remove` / `sections` for one module |
| `vocabularies/*.yaml` | Controlled lists |
| `vocabularies/<name>/<domain>.yaml` | A domain's extra terms for one vocabulary |
| `types/*.yaml` | A note type: the modules it uses plus its own properties |
| `types/<type>/<domain>.yaml` | A domain's `override` / `add` / `remove` for one type |
| `preview/` | Generated, read-only (see [The preview folder](#the-preview-folder)) |

The schema folder is `_schema` by default. A name starting with a dot (`.schema`) is hidden from Obsidian but still read; use **Reload schemas** after editing it elsewhere. The settings page can pick another root folder name.

## Who writes what

| File | Written by |
| --- | --- |
| `registry/types.yaml`, `registry/domains.yaml`, `modules/**`, `types/**`, `vocabularies/**` | You. The plugin never changes them, except one term added to a vocabulary file when you click *Add to vocabulary* (into the note's domain file when it has one) |
| `registry/folders.yaml`, `registry/scope.yaml` | You, or the plugin when you change a folder mapping or scope rule in settings or answer the "which schema?" prompt. Comments are kept |
| The starter pack | The command **Install starter schema pack**, which only creates files that are missing and never overwrites |
| `preview/**` | The plugin only. Rewritten when the schema changes; never read back |
| Any schema file, when you apply a preset | The plugin, after a preview and a backup preset (see [Schema presets and export](#schema-presets-and-export)) |

## Registry files

### registry/types.yaml

| Key | Meaning |
| --- | --- |
| `format` | Version of this schema language. Currently `1`. A newer format than the plugin understands is refused (the last good copy stays in use) |
| `min_plugin_version` | Oldest plugin version that understands this pack |
| `pack_version` | Version of the starter pack the files came from. Not read by the plugin yet; it lets an update say what is new |
| `modules` | Map of module name → file path (relative to the schema folder) |
| `vocabularies` | Map of vocabulary name → file path |
| `types` | Map of type name → `{ file, prefix, version }`. `prefix` is two capital letters used in IDs and unique across types. `version` is the number written to `schema` in notes; a note with a lower number is offered a migration, a note with a higher one is read-only |

### registry/domains.yaml

The domains, registered like types. Optional: without it the domains come from the `domain` property's own `values` (and `prefixes`), as in earlier packs.

```yaml
default: general           # the domain of a note that has none and is not in a domain folder
domains:
  general:  { prefix: GE, description: Everything that has no domain of its own. }
  maths:    { prefix: MA }
  pcb:      { prefix: PC, folder: pcb }
```

| Key | Meaning |
| --- | --- |
| `default` | A listed domain. Used for a note that has no `domain` and is not in a domain folder. Absent: the first domain listed |
| `domains` | Map of domain name → `{ prefix, folder, description }` (or `{}`). A name is a lowercase slug (letters, digits, single hyphens): it is a file name, a folder name and the start of section values. Never rename one |
| `prefix` | Two capital letters, unique across the domains, used in `unique_id` (`KB-MA-2026-0001`). **Optional**: a domain without one gets no unique ID. Declared, not guessed from the word (physics and philosophy would both be `PH`) |
| `folder` | The folder name that means this domain below a type's root folder (default: the domain's own name). One folder name, no slash; unique across domains, ignoring case and accents |
| `description` | Free text for people |

The `domain` property takes its values, its default and the prefixes from this file with `values_from: domains`. The override folders (`types/kb/maths.yaml`) are keyed by these names, and a file for a name that is not listed here is an error.

### registry/folders.yaml

| Key | Meaning |
| --- | --- |
| `mode` | `combined` (type, then breadcrumb, then folder name, then ask), `auto` (same without asking), `manual` (you choose per note or folder) |
| `order` | Documented, fixed: `type, breadcrumb, folder, ask`. Other values are reported and ignored |
| `folders` | Map of root folder name → type name. One type may have several folders. Names are compared ignoring case and accents |

If two types claim the same folder the plugin warns and asks which one owns it; it never picks silently. Only the **first** folder of a note's path counts, so `Knowledge/maths/Limits.md` is in `Knowledge`.

### registry/scope.yaml

| Key | Meaning |
| --- | --- |
| `mode` | `exclude` (everything except `exclude`) or `include-only` (only `include`) |
| `exclude` | Folders that are not managed. Exclude always wins. The schema folder is always excluded and not listed |
| `include` | Folders that are managed in `include-only` mode |

An excluded note gets no suggestions, no picker, no validation, no automation and no prompts.

## Modules, types and vocabularies

**Module file**

| Key | Meaning |
| --- | --- |
| `module` | Its name (should match the registry) |
| `description` | Optional text for people |
| `requires` | Optional list of modules a type must also list under `uses` when it uses this one (`curriculum` requires `domain`). The type lists them itself, so the order of its properties stays its own; a type that omits one gets an error naming both |
| `properties` | Map of property name → [attributes](#property-attributes). A module with none is an error (a file saved over a module would otherwise vanish silently) |

**Type file**

| Key | Meaning |
| --- | --- |
| `type` | The type name (should match the registry) |
| `description` | Optional text for people |
| `uses` | Module names, in order. Must include `base`. The note's [property order](#property-order) follows this list |
| `overrides` | Changes to a module property for this type only (in every domain). May change `values`, `default`, `required`. Used to give `status` its values and default |
| `properties` | The type's own properties |
| `body` | Opts the type in to [body access](#body-access): `body: { enabled: true }`. Absent, or `enabled: false`, means off. **Reserved: no body behaviour ships yet**, so turning it on changes nothing today. Keys other than `enabled` are a warning (`body-unknown-key`) so a pack can name keys that a later version understands; a `body` that is not a map, or an `enabled` that is not true or false, is an error (`body-shape`). Read from the type file only; a domain override file cannot change it |

**Vocabulary file**

| Key | Meaning |
| --- | --- |
| `vocabulary` | Its name |
| `terms` | Map of preferred term → `{ synonyms: [...] }` (or `{}`) |

A synonym is replaced by its preferred term where the property has `normalise: true`; an unknown term is flagged where it has `strict: true`. A word may be a term or a synonym of one term, never both, and never a synonym of two. Matching ignores case.

## Value types

| `type` | Format | Notes |
| --- | --- | --- |
| `string` | Text | `pattern` may require a regular expression |
| `integer` | Whole number | `min` and `max` may limit it |
| `boolean` | `true` or `false` | |
| `date` | `YYYY-MM-DD` | `default: today` is allowed |
| `datetime` | `YYYY-MM-DDTHH:mm` | Local time, no timezone |
| `url` | `http`, `https`, `ftp` or `mailto` address | |
| `link` | A quoted wiki-link `"[[Note]]"` | `target` limits suggestions to one type; `allow_heading: true` accepts `"[[Note#Heading]]"` |
| `enum` | One of `values` (or `values_from`) | |
| `list` | A list; `items` gives the item type | `items`: `string`, `link`, `url` or `term` (a controlled term; needs `vocabulary`) |

The value checks report one of: `type` (wrong kind), `enum` (not an allowed value), `min`, `max`, `pattern`, `format` (a date or URL that does not parse), `link` (not a wiki-link) and `heading` (a heading where none is allowed).

## Property attributes

| Attribute | Applies to | Meaning |
| --- | --- | --- |
| `type` | all | Value type (see above) |
| `items` | `list` | Item type: `string`, `link`, `url` or `term` |
| `required` | all | Must be present. Missing required properties are found by the vault check and added with their defaults when a note is filled |
| `default` | all | Value used when a note is created. `today` is allowed for `date`. A property is written at creation when it is `required` or has a `default` |
| `values` | `enum` | Allowed values, in menu order. A domain may replace them |
| `values_from` | `enum` | `type` = the values come from the type's `overrides` (used by `status`); `registry` = the values are the type names (used by `type`); `domains` = the values, the default and the prefixes come from `registry/domains.yaml` (used by `domain`) |
| `min`, `max` | `integer` | Limits |
| `pattern` | `string` | A regular expression the value must match |
| `vocabulary` | list of `term` | Name of the controlled list |
| `strict` | controlled | Unknown terms are flagged |
| `normalise` | controlled | Synonyms are replaced by the preferred term |
| `locked` | all | Never opens a picker in the Properties area; a short note says who manages it |
| `immutable` | all | Never changes after it is first written; changes are reported by the vault check |
| `generated` | all | The plugin fills it in |
| `managed_by` | all | `external`: another plugin writes it (for example `breadcrumb`); this plugin only reads and checks it |
| `position: end` | all | Always sorts after every other property, in declared order |
| `allow_heading` | `link` | The link may include a heading |
| `target` | `link`, list of `link` | Link suggestions are limited to notes of this type |
| `prefixes` | `enum` (the `domain` property) | The earlier form, for a pack with **no** `registry/domains.yaml`: maps each value to a two-letter prefix, `{ general: GE, maths: MA }` (two capital letters, unique, keys must be values). With a registry the prefixes live there, and having both is an error |
| `description` | all | Free text for people reading the file |

Rules that are easy to trip over:

- A property name must have the **same value type** (and item type) in every type and every domain, because Obsidian keeps one type per property name across the vault. Enum value lists may differ.
- A default must be valid for its property: an enum default must be one of the values, an integer default a whole number within `min`/`max`.
- `min` and `max` on a property that is not an integer, `items` on one that is not a list, and `prefixes` on one that is not an enum give a warning, not an error. An unknown attribute is a warning too.
- Never rename or remove a value that notes already use; append instead. Renaming means editing every note.

## Property order

A note's properties are written in this order: the modules in the order of `uses`, then the type's own properties, then `archived_fields` (if the note has it), then `created` and `modified` (they have `position: end`). Properties a domain adds go after the type's own and before `created` and `modified`. The order is applied whenever the plugin writes a note.

## Built-in and locked properties

| Property | Kind | Meaning |
| --- | --- | --- |
| `schema` | locked, generated | The schema version the note was written against |
| `id` | locked, generated, immutable | The global ID `PREFIX-YYYY-NNNN` |
| `unique_id` | locked, generated | The domain-level ID `TYPE-DOMAIN-YEAR-NNNN` (types that use the `domain` module) |
| `created` | locked, generated, immutable, `position: end` | Local time, set once, `YYYY-MM-DDTHH:mm` |
| `modified` | locked, generated, `position: end` | Local time of the last change; the only value written without asking. Moves, breadcrumb rewrites and the plugin's own writes do not change it |
| `breadcrumb` | locked, `managed_by: external` | Written by a breadcrumb plugin if you use one; this plugin never writes it unless you turn on **Set breadcrumb from the folder** |
| `archived_fields` | built in, locked | Values kept when a note changes type or a unique ID is reissued: entries with the old type, the date and the values. Never deleted |

`created` and `modified` use local time with no timezone, so the hour when clocks go back is ambiguous.

## IDs

| | `id` | `unique_id` |
| --- | --- | --- |
| Format | `KB-2026-0001` (type prefix, year, number) | `KB-MA-2026-0001` (type prefix, domain prefix, year, number) |
| Counter | per type and year | per type, domain and year |
| Changes | **Never.** A converted note keeps its old `id` | **Issued again** when the note's domain or type changes; the old one goes to `archived_fields` |
| Use it for | Links and references | Reading ("the 42nd maths note this year") |
| Where | Every type | Types that use the `domain` module, for domains that have a prefix |

How numbers are chosen: one more than the highest in use for that prefix and year, worked out from the notes themselves. There is no counter file. A year comes from `created` and a new year starts again at `0001`. A value given up by renumbering or reissuing is never handed out again.

**Retired IDs** are listed under *Retired IDs* in the settings, each with what it does to numbering. An ID is retired when a note is renumbered or its unique ID is issued again. Releasing one forgets it; its number can then be issued again only if no note, and no other retired ID, uses a higher number of the same type and year (and domain), because the next number is always one more than the highest. Release one only if nothing outside the vault refers to it.

Two notes with the same ID or unique ID (for example created offline on two devices): the vault check keeps it on the older note and offers the newer one the next free number, with a preview. A malformed ID is reported and never changed. The plugin never moves or renames files.

## Domains and overrides

A **domain** is an entry in `registry/domains.yaml` and a value of the `domain` property (module `domain`): `maths`, `physics`, `pcb`... A note's `domain` selects extra files that adjust the schema for it **without forking it**. The effective schema for a note is the **default plus the override file named for its domain**. No override file means the default applies, so a vault with no override folders behaves exactly as it always did.

### Where a note's domain comes from

A note's domain is its own `domain` property. When a note has none, the plugin takes it from the **folder**: the first folder below the root that is a registered domain's `folder` (its own name unless the registry says otherwise), ignoring case and accents. `Knowledge/maths/Limits.md` and `Knowledge/maths/algebra/Groups.md` are in `maths`; `Knowledge/Limits.md` and `Knowledge/Problems/x.md` are in no domain, so they get the registry's `default` domain (`general`). The root folder itself is the type's (`maths/Limits.md` is not in the maths domain). A domain's `folder` in the registry can differ from its name (`maths` with `folder: Mathematics` means `Knowledge/Mathematics/`).

This applies when the plugin **fills** a note (an automatic fill, **Choose schema for this note**, a conversion) and in **Create note from schema**, whose folder list offers each domain's folder (`Knowledge/maths`) for a type that has a domain. The note is completed with that domain's defaults: its section, kinds, added properties and the `unique_id` prefix. A note that already has a `domain` keeps it, whatever the folder says.

The vault check warns when a note's folder names a domain that is not its `domain` (`domain-folder`) and offers to set the property to match. It never moves a file. Keeping notes in domain folders is a convention, not a rule.

### The three verbs

Override files sit next to the file they change, in a folder of the same name, one file per domain, named by the domain:

```
types/kb.yaml                       default
types/kb/maths.yaml                 kb notes in the maths domain
modules/curriculum/maths.yaml       the curriculum module in the maths domain
vocabularies/tags/maths.yaml        extra tags for maths
vocabularies/tracks/maths.yaml      extra tracks for maths
```

Type and module files use `domain` plus any of three verbs:

```yaml
domain: maths
override:                # change values, default or description of an existing property
  kind:
    values: [definition, theorem, proof]
    default: definition
add:                     # properties allowed only for this domain (full property definitions)
  prerequisite_theorems: { type: list, items: link }
remove: [audience]       # properties not allowed for this domain
sections: [maths-algebra, maths-analysis]     # module files only: extra values for the module's `section`
```

Vocabulary files are `domain:` plus `terms:`, in the same shape as the default vocabulary.

### Rules

- The file name is the domain slug, it must be a registered domain, and the file must say `domain: <slug>` too.
- A **type** file may name any property of the type. A **module** file may only name properties of that module and applies to every type that uses it. Module files apply first (in the order of the type's `uses`), then the type file.
- Within a file the order is: remove, override, sections, add. One property cannot appear under two verbs in one file. Removing a property twice (in a module file and then again in the type file) is an error: the second finds nothing to remove.
- `override` can change only `values` (replacing the list, and only on an enum), `default` and `description`. Changing `type`, or any other key, is an error. A default is checked after the whole file is applied, so it may be one of the file's own `sections`.
- `add` puts the property after the type's own and before `created` and `modified`. A name the type already has is an error.
- `remove` of a name the type does not have is an error.
- **Core properties cannot be removed:** `type`, `schema`, `id`, `name`, `status`, `domain`, `section`, `level`, `order`, `created`, `modified`.
- `sections` extends the module's `section` list with the domain's own. A section already in the default list is an error.
- Every `section` value and every `track` term for a domain starts with `<domain>-`.
- A vocabulary term or synonym that equals a default term or synonym is an error, and the default wins.
- A property added in two domains must have the same value type in both (and as everywhere else, across all types).
- A domain with no `prefix` in the registry gets no `unique_id`; a type with a `unique_id` property when no domain at all has a prefix is an error.

### What a note is checked against

Its domain's effective schema: values, required properties, option lists, autocomplete, tag synonyms and the vault check. The vault check also reports a `section` or `track` that does not start with the note's domain, and a property the domain removed that is still present (reported only, never deleted). The "Add to vocabulary" fix writes into the domain's vocabulary file when it has one.

The existing `overrides:` key in a **type** file is a different thing: it adjusts a module property for that type in every domain (`values`, `default`, `required`). Domain overrides live in their own files so a type file never has to name a domain.

### Add a domain

1. Add a line to `registry/domains.yaml`: `physics: { prefix: PY }`. The prefix is optional (no prefix, no unique IDs); a `folder` is optional (default: the name).
2. Add override files only where it differs from the default. Section values and track terms start with `<domain>-`.
3. Save. Reload happens by itself; problems name the file and line.

### The preview folder

`preview/<type>.yaml` is written by the plugin, not by you. It shows what a new note of that type starts with (the properties in order with their starting values, and a comment after each saying what is allowed) and lists the properties that are not written until used. Where a domain changes a type, it also writes `preview/<type>/<domain>.yaml`: how a new note of that type starts **in that domain**, with a line saying what the domain adds, removes and changes. Files are rewritten only when their text changes and only from a schema that loaded cleanly; they are never read back, so editing one changes nothing. Files for a type or domain that no longer exists are removed (only ones with the generated header). The schema reload ignores the folder. The setting **Write property previews to the schema folder** turns it off.

## The shipped pack

The starter pack (**Install starter schema pack** creates any file that is missing) has the types, modules and vocabularies below. Everything in `types/<type>/`, `modules/curriculum/`, `vocabularies/tags/` and `vocabularies/tracks/` is an **example** domain override: keep, edit or delete it.

### Types

| Type | Prefix | Schema | Folder | Modules used | Status values (default first) | Its own properties |
| --- | --- | --- | --- | --- | --- | --- |
| `note` | NT | 2 | `Notes` | `base`, `findability`, `relations` | draft, in-progress, evergreen, archived | `confidence` |
| `kb` | KB | 2 | `Knowledge`, `Wiki` | `base`, `findability`, `relations`, `provenance`, `review`, `pathways`, `domain`, `curriculum`, `verification` | draft, review, published, outdated, archived | `kind`, `audience`, `confidence` |
| `resource` | RS | 2 | `Resources` | `base`, `findability`, `relations` | to-consume, in-progress, done, abandoned | `resource_type`, `creator`, `url`, `published`, `rating`, `takeaways`, `progress_percent`, `progress_started`, `progress_finished` |
| `project` | PR | 2 | `Projects` | `base`, `findability`, `relations` | planning, idea, active, on-hold, done, cancelled | `priority`, `start`, `deadline`, `outcome`, `stakeholders` |
| `task` | TK | 2 | `Tasks` | `base`, `findability`, `relations` | todo, doing, waiting, done, cancelled | `priority`, `project`, `context`, `effort`, `scheduled`, `due`, `completed`, `depends_on`, `recurrence_rule`, `recurrence_until` |
| `exercise` | EX | 1 | `Exercises` | `base`, `findability`, `relations`, `review`, `pathways`, `domain`, `curriculum`, `verification` | draft, review, published, outdated, archived | `difficulty`, `time_minutes`, `tests`, `answer_verified`, `confidence` |
| `scenario` | SC | 1 | `Scenarios` | `base`, `findability`, `relations`, `review`, `pathways`, `domain`, `curriculum`, `verification` | draft, review, published, outdated, archived | `decision_type`, `difficulty`, `time_minutes`, `tests`, `senior_signal`, `answer_verified`, `confidence` |
| `example` | EG | 1 | `Examples` | `base`, `findability`, `relations`, `review`, `pathways`, `domain`, `curriculum`, `verification` | draft, review, published, outdated, archived | `demonstrates`, `difficulty`, `confidence` |
| `journal` | JR | 2 | `Journal` | `base`, `findability`, `relations` | open, closed | `date`, `period`, `mood`, `energy`, `location`, `highlights` |
| `person` | PE | 2 | `People` | `base`, `findability`, `relations` | active, dormant, archived | `relationship`, `organisation`, `role`, `location`, `birthday`, `last_contacted`, `follow_up`, `contact_email`, `contact_phone`, `contact_website`, `contact_social`, `met_date`, `met_where` |
| `workout` | WK | 1 | `Workouts` | `base`, `findability`, `relations` | draft, tested, reliable, archived | `category`, `kind`, `measure`, `equipment`, `muscles_primary`, `muscles_secondary`, `technique`, `mistakes` |

### Modules

| Module | Requires | Properties |
| --- | --- | --- |
| `base` |  | `type`, `schema`, `id`, `name`, `status`, `created`, `modified` |
| `findability` |  | `aliases`, `description`, `keywords`, `tags`, `language` |
| `relations` |  | `parent`, `related`, `supersedes`, `superseded_by` |
| `review` |  | `review_cycle`, `review_last`, `review_next` |
| `provenance` |  | `source_title`, `source_author`, `source_url`, `source_accessed` |
| `verification` |  | `ai_generated`, `generated_by`, `verified`, `verified_by`, `references` |
| `pathways` |  | `prerequisites`, `next`, `companion` |
| `domain` |  | `domain`, `unique_id` |
| `curriculum` | `domain` | `section`, `level`, `topic`, `order`, `track` |

### Vocabularies

| Vocabulary | Used by | Terms |
| --- | --- | --- |
| `tags` | the `tags` property (module `findability`), `strict` and `normalise` | A small generic set with synonyms (for example `quantum` for `qm`); each domain adds its own in `vocabularies/tags/<domain>.yaml` |
| `tracks` | the `track` property (module `curriculum`), `strict` and `normalise` | Learning paths. Every term starts with its domain and a hyphen; `general-getting-started` is the default, each domain adds its own in `vocabularies/tracks/<domain>.yaml` |

### Property index

Every property in the pack, with where it is defined. Values are the default lists; a domain may replace them (see the domain table).

| Property | Value | Defined in | Required | Default |
| --- | --- | --- | --- | --- |
| `ai_generated` | boolean | module `verification` |  | `false` |
| `aliases` | list of string | module `findability` |  | `[]` |
| `answer_verified` | boolean | type `exercise`, type `scenario` |  | `false` |
| `audience` | self \| team \| public | type `kb` |  | `"self"` |
| `birthday` | date | type `person` |  |  |
| `category` | mobility \| strength \| stability \| cardio \| skill | type `workout` |  | `"mobility"` |
| `companion` | link | module `pathways` |  |  |
| `completed` | date | type `task` |  |  |
| `confidence` | low \| medium \| high | type `note`, type `kb`, type `exercise` and 2 more |  | `"medium"` |
| `contact_email` | string | type `person` |  |  |
| `contact_phone` | string | type `person` |  |  |
| `contact_social` | list of url | type `person` |  |  |
| `contact_website` | url | type `person` |  |  |
| `context` | string | type `task` |  |  |
| `created` | datetime | module `base` | yes |  |
| `creator` | string | type `resource` |  |  |
| `date` | date | type `journal` | yes | `"today"` |
| `deadline` | date | type `project` |  |  |
| `decision_type` | diagnosis \| trade-off \| design-choice \| review \| planning | type `scenario` | yes | `"diagnosis"` |
| `demonstrates` | link → kb | type `example` |  |  |
| `depends_on` | list of link | type `task` |  | `[]` |
| `description` | string | module `findability` |  |  |
| `difficulty` | beginner \| intermediate \| advanced \| senior | type `exercise`, type `scenario`, type `example` | yes | `"beginner"` |
| `domain` | one of the domains | module `domain` | yes | `"general"` |
| `due` | date | type `task` |  |  |
| `effort` | string | type `task` |  |  |
| `energy` | whole number 1–5 | type `journal` |  |  |
| `equipment` | list of string | type `workout` |  |  |
| `follow_up` | date | type `person` |  |  |
| `formula` | string | domain `physics` (type `kb`) |  |  |
| `generated_by` | string | module `verification` |  |  |
| `highlights` | list of string | type `journal` |  |  |
| `id` | string | module `base` | yes |  |
| `keywords` | list of string | module `findability` |  |  |
| `kind` | concept \| how-to \| reference \| troubleshooting \| faq \| checklist \| glossary \| case-study \| index | type `kb`, type `workout` |  | `"concept"` |
| `language` | en-GB \| en-US \| fr \| de \| es | module `findability` |  | `"en-GB"` |
| `last_contacted` | date | type `person` |  |  |
| `level` | beginner \| intermediate \| advanced | module `curriculum` | yes | `"beginner"` |
| `location` | string | type `journal`, type `person` |  |  |
| `measure` | time \| reps \| distance \| load \| quality | type `workout` |  |  |
| `met_date` | date | type `person` |  |  |
| `met_where` | string | type `person` |  |  |
| `mistakes` | link | type `workout` |  |  |
| `modified` | datetime | module `base` | yes |  |
| `mood` | whole number 1–5 | type `journal` |  |  |
| `muscles_primary` | list of string | type `workout` |  |  |
| `muscles_secondary` | list of string | type `workout` |  |  |
| `name` | string | module `base` | yes |  |
| `next` | link | module `pathways` |  |  |
| `order` | whole number 1– | module `curriculum` | yes | `10` |
| `organisation` | string | type `person` |  |  |
| `outcome` | string | type `project` |  |  |
| `parent` | link | module `relations` |  |  |
| `period` | daily \| weekly \| monthly \| yearly | type `journal` |  | `"daily"` |
| `prerequisite_theorems` | list of link → kb | domain `maths` (type `kb`) |  |  |
| `prerequisites` | list of link | module `pathways` |  | `[]` |
| `priority` | whole number 1–5 | type `project`, type `task` |  | `3` |
| `progress_finished` | date | type `resource` |  |  |
| `progress_percent` | whole number 0–100 | type `resource` |  | `0` |
| `progress_started` | date | type `resource` |  |  |
| `project` | link → project | type `task` |  |  |
| `published` | date | type `resource` |  |  |
| `question_kind` | calculation \| proof-writing | domain `maths` (type `exercise`) |  | `"calculation"` |
| `rating` | whole number 1–5 | type `resource` |  |  |
| `recurrence_rule` | string | type `task` |  |  |
| `recurrence_until` | date | type `task` |  |  |
| `references` | list of string | module `verification` |  |  |
| `related` | list of link | module `relations` |  | `[]` |
| `relationship` | friend \| family \| colleague \| client \| mentor \| other | type `person` |  |  |
| `resource_type` | book \| article \| video \| podcast \| course \| paper \| tool \| required | type `resource` |  |  |
| `review_cycle` | none \| 1-month \| 3-months \| 6-months \| yearly | module `review` |  | `"6-months"` |
| `review_last` | date | module `review` |  |  |
| `review_next` | date | module `review` |  |  |
| `role` | string | type `person` |  |  |
| `scheduled` | date | type `task` |  |  |
| `schema` | whole number | module `base` | yes |  |
| `section` | general-start-here \| general-reference | module `curriculum` | yes | `"general-start-here"` |
| `senior_signal` | string | type `scenario` |  |  |
| `source_accessed` | date | module `provenance` |  |  |
| `source_author` | string | module `provenance` |  |  |
| `source_title` | string | module `provenance` |  |  |
| `source_url` | url | module `provenance` |  |  |
| `stakeholders` | list of link → person | type `project` |  |  |
| `standards` | list of string | domain `embedded` (type `kb`), domain `pcb` (type `kb`) |  |  |
| `start` | date | type `project` |  |  |
| `status` | draft \| in-progress \| evergreen \| archived | module `base` | yes | `"draft"` |
| `superseded_by` | link | module `relations` |  |  |
| `supersedes` | list of link | module `relations` |  | `[]` |
| `tags` | list of term (tags) | module `findability` |  |  |
| `takeaways` | link | type `resource` |  |  |
| `target_mcu` | string | domain `embedded` (type `kb`) |  |  |
| `technique` | link | type `workout` |  |  |
| `tests` | list of link → kb | type `exercise`, type `scenario` |  |  |
| `time_minutes` | whole number 1– | type `exercise`, type `scenario` | yes | `10` |
| `toolchain` | string | domain `embedded` (type `kb`) |  |  |
| `tools_needed` | list of string | domain `pcb` (type `exercise`) |  |  |
| `topic` | string | module `curriculum` |  |  |
| `track` | list of term (tracks) | module `curriculum` |  | `[]` |
| `type` | one of the types | module `base` | yes |  |
| `unique_id` | string | module `domain` |  |  |
| `units` | string | domain `physics` (type `kb`) |  |  |
| `url` | url | type `resource` |  |  |
| `verified` | boolean | module `verification` |  | `false` |
| `verified_by` | string | module `verification` |  |  |

### Domains

Registered in `registry/domains.yaml`. `general` has no override files: it is the default.

| Domain | Prefix | Folder | Sections it adds (first is the default) | Override files | Description |
| --- | --- | --- | --- | --- | --- |
| `general` (default) | GE | `general` | none | none | Everything that has no domain of its own. |
| `maths` | MA | `maths` | `maths-foundations`, `maths-algebra`, `maths-analysis`, `maths-statistics` | `modules/curriculum/maths.yaml`, `types/kb/maths.yaml`, `types/exercise/maths.yaml`, `vocabularies/tags/maths.yaml`, `vocabularies/tracks/maths.yaml` | Mathematics. |
| `physics` | PY | `physics` | `physics-mechanics`, `physics-waves-optics`, `physics-electromagnetism`, `physics-thermal` | `modules/curriculum/physics.yaml`, `types/kb/physics.yaml`, `vocabularies/tags/physics.yaml`, `vocabularies/tracks/physics.yaml` | Physics. |
| `pcb` | PC | `pcb` | `pcb-foundations`, `pcb-layout-routing`, `pcb-power-thermal`, `pcb-high-speed`, `pcb-manufacturing`, `pcb-reference` | `modules/curriculum/pcb.yaml`, `types/kb/pcb.yaml`, `types/exercise/pcb.yaml`, `types/scenario/pcb.yaml`, `vocabularies/tags/pcb.yaml`, `vocabularies/tracks/pcb.yaml` | Printed circuit board design. |
| `embedded` | EM | `embedded` | `embedded-foundations`, `embedded-peripherals`, `embedded-rtos`, `embedded-debugging` | `modules/curriculum/embedded.yaml`, `types/kb/embedded.yaml`, `types/scenario/embedded.yaml`, `vocabularies/tags/embedded.yaml`, `vocabularies/tracks/embedded.yaml` | Embedded systems and firmware. |

#### What each domain changes

| Domain | Type | Adds | Removes | Changes |
| --- | --- | --- | --- | --- |
| `maths` | `kb` | `prerequisite_theorems` | `audience` | `kind` → definition \| theorem \| proof \| example \| concept (default definition); `section` default `maths-foundations` |
| `maths` | `exercise` | `question_kind` |  | `section` default `maths-foundations` |
| `maths` | `scenario` |  |  | `section` default `maths-foundations` |
| `maths` | `example` |  |  | `section` default `maths-foundations` |
| `physics` | `kb` | `units`, `formula` |  | `kind` → law \| derivation \| experiment \| concept \| reference (default concept); `section` default `physics-mechanics` |
| `physics` | `exercise` |  |  | `section` default `physics-mechanics` |
| `physics` | `scenario` |  |  | `section` default `physics-mechanics` |
| `physics` | `example` |  |  | `section` default `physics-mechanics` |
| `pcb` | `kb` | `standards` |  | `kind` → how-to \| troubleshooting \| checklist \| concept \| reference \| case-study (default concept); `section` default `pcb-foundations` |
| `pcb` | `exercise` | `tools_needed` |  | `section` default `pcb-foundations` |
| `pcb` | `scenario` |  |  | `decision_type` → diagnosis \| trade-off \| sourcing \| design-choice \| review (default diagnosis); `section` default `pcb-foundations` |
| `pcb` | `example` |  |  | `section` default `pcb-foundations` |
| `embedded` | `kb` | `target_mcu`, `toolchain`, `standards` |  | `kind` → how-to \| driver \| datasheet-notes \| concept \| troubleshooting (default concept); `section` default `embedded-foundations` |
| `embedded` | `exercise` |  |  | `section` default `embedded-foundations` |
| `embedded` | `scenario` |  |  | `decision_type` → architecture \| debugging \| real-time \| trade-off (default debugging); `section` default `embedded-foundations` |
| `embedded` | `example` |  |  | `section` default `embedded-foundations` |

#### Tags and tracks added by each domain

| Domain | Tags | Tracks |
| --- | --- | --- |
| `maths` | `theorem` (thm), `lemma`, `proof`, `algebra`, `calculus` (calc) | `maths-first-course`, `maths-proof-writing` |
| `physics` | `mechanics`, `optics`, `thermodynamics` (thermo), `electromagnetism` (em-theory), `units` | `physics-first-course`, `physics-lab-skills` |
| `pcb` | `schematic`, `layout`, `routing`, `stack-up` (stackup, layer-stack), `decoupling` (bypassing), `impedance`, `emc` | `pcb-first-board`, `pcb-high-speed`, `pcb-manufacturing` |
| `embedded` | `rtos`, `interrupts` (isr), `dma`, `firmware`, `bootloader` | `embedded-first-firmware`, `embedded-real-time` |

Keeping notes in `<root folder>/<domain>/`, for example `Knowledge/maths/Limits.md`, is a convention the plugin does not enforce: it matches on the first folder only and never moves a file.

## How a note finds its schema

In this order, first match wins (mode `combined`): a valid `type` in the note; the first segment of `breadcrumb` against the folder list; the note's first folder (listed in `folders.yaml`, or named like a type); otherwise you are asked once for that folder, with "Leave unmanaged" and a tick box to remember the answer ("Not now" stops the question for that folder). A note in the vault root stays unmanaged until you use **Choose schema for this note**. `auto` is the same without asking; `manual` leaves it to you.

Notes outside the managed scope get no suggestions, no picker, no checks, no prompts and no stamps.

## What the plugin does

| When | What happens |
| --- | --- |
| Rubric is **off** (the default on a fresh install) | Nothing changes a note and nothing asks about one. Schema loading, the problem list, Check vault (read only), option lists, the previews, and adding a vocabulary term still work. Turn it on from the status bar, the settings page or **Toggle automation on or off** |
| A note is edited | `modified` is stamped about a second and a half after you stop changing it. Moves, breadcrumb rewrites and the plugin's own writes do not count |
| A note is created in a mapped folder | After it has its real name, it is filled (type, schema, id, unique id, name, status, created, modified, defaults), asked about, or left alone, as set in **When a note is created in a mapped folder**. A note in a domain folder (`Knowledge/maths/`) gets that domain and its defaults |
| A note is renamed or moved | `name` follows the file name if it was empty or filled by the plugin; `breadcrumb` follows the folder only if you turned that on. Moving never changes `modified` |
| `type` changes, or a move changes the breadcrumb's first segment | A preview, then a conversion. Values that no longer apply go to `archived_fields`; the `id` is kept; the `unique_id` is issued again |
| `domain` changes | A preview, then a new `unique_id` (the old one kept in `archived_fields`) |
| A tag is a synonym, unknown, or `status` is not allowed | A prompt (open notes by default). Prompts can be switched off |
| A schema file is invalid | One notice naming the file and line; the last good copy stays in use |
| A note's body | Nothing in Rubric edits it. The [body access layer](#body-access) is only there for later features |

Notes that arrive through sync never prompt; the vault check covers them.

## Schema presets and export

A **preset** is a named copy of every schema file (YAML files and `REFERENCE.md`, in every sub-folder). It is kept in the plugin's own folder (`.obsidian/plugins/rubric/presets/`, one JSON file each), not in the schema folder, so it is never read as a schema. The generated `preview/` folder and your notes are never part of a preset.

| Where | What it does |
| --- | --- |
| Settings → **Schema presets and export** → *Save the schema as a preset*, or the command **Save schema as preset** | Asks for a name and keeps a copy. A name that is already used asks before replacing |
| Settings → **Saved presets** (select one), or the command **Apply schema preset** | Shows every file that would be added, replaced or removed, and waits. On approval: saves your current schema as a preset called *Before applying “name” date time*, makes the schema folder match the preset exactly, and reloads the schemas. If a schema file changed while the preview was open, nothing is applied. To go back, apply the backup preset |
| The delete button on a saved preset | Asks, then deletes the preset file. The schema folder is not changed |
| Settings → *Export the schema as a zip*, or the command **Export schema as zip** | Writes the schema folder (without `preview/`) to `Rubric schema <date> <time>.zip` in the top folder of the vault, with the files under the schema folder's name. An existing zip is never overwritten |

Applying a preset replaces files, so keep a copy of anything you are not sure about; the automatic backup covers the schema files only. Presets and exports do not need Rubric to be switched on, because they change schema files and not notes.

## Body access

**Status: no body behaviour ships yet.** Rubric manages a note's properties. The body access layer is an internal foundation that lets later features read and edit the body of a note safely. Nothing in this version edits a body, so with the setting below off, or with no type opted in, Rubric behaves exactly as before.

**Who may change a body.** All of these must hold, checked in this order; the first that fails is the reason a write or a handler is refused:

| # | Rule |
| --- | --- |
| 1 | Rubric is on (the master switch) |
| 2 | The setting **Allow Rubric to edit note bodies** is on (off by default) |
| 3 | The note is managed: inside the scope in `registry/scope.yaml` and not in the schema folder |
| 4 | A schema matches the note |
| 5 | Its type has `body: { enabled: true }` |
| 6 | The note is not on a newer schema than the plugin knows (those are read-only) |

Reading a body is never refused. The setting **Log body access** writes one line to the developer console for each body change or refusal (which handler, which note, how many characters) and adds the command **Body access: show sections**: the active note's type, whether `body.enabled` is on, whether body edits are allowed and why not, and its heading tree with line ranges.

**What a handler can do.** A handler is code that registers for a key and sees a keypress in the body of an opted-in note before Obsidian does. It can only be registered by code; there is nothing to write in the schema except `enabled`.

- Keys: `Enter`, `Tab`, `Shift-Tab`. Deleting keys are not offered.
- It is told the note's type, the cursor line and column, the line, whether anything is selected, the list item the line starts (marker, task box, depth: a tab or the tab size in spaces is one level) and the innermost section (heading text, level, line).
- It answers **claim** (the key is handled; Obsidian does not see it) or **pass** (the next handler, then Obsidian, gets it). The first claim wins.
- It records edits through a transaction: insert text at the cursor or another place, insert whole lines after a line, move the cursor. Everything it records is applied together as **one undo step**.
- It may only insert. Replacing or deleting existing text needs the handler to have been registered as allowed to rewrite, and the edit is then explicit. Edits that fall outside the note or overlap are dropped; a handler that fails is skipped and the key goes on to Obsidian.
- It is **not** run while an input method (IME) is composing, with several cursors, in the frontmatter, or inside a code fence, a `$$` math block or a `%%` comment.

**What the file API can do.** For features that act on a note that is not being typed in: read the body, its lines and its sections; replace the body only if it is still what the caller read; change the body with a function that sees it as it is at that moment; or insert text at a heading. Every write is one atomic read-modify-write, never touches the frontmatter, keeps the note's line endings, reports "nothing changed" instead of writing an identical file, and is done even when the note is open with unsaved typing (both are kept; it is one undo step). A body write counts as an edit, so `modified` is stamped afterwards as for your own typing; in an open note that stamp is its own undo step, so undo twice to take back a body write once `modified` has been stamped.

Insert positions relative to a heading, always as whole lines and never inside a code block:

| Position | Where |
| --- | --- |
| `start` | The line under the heading |
| `end` | After the last line of the section's own text, before its first sub-heading |
| `after` | After the last line of the whole section, sub-sections included |
| `before` | The line above the heading |

**What counts as a heading** follows Obsidian: `#` to `######` headings (up to three spaces of indent, a space after the hashes, optional closing hashes), and a line of text over `===` or `---` (only for a single line of text). Lines inside code fences (```` ``` ```` or `~~~`, a closing fence must be as long as the opening one), `$$` math blocks, `%%` comments and indented code are not headings.

## Vault check

**Check vault** scans every managed note and reports what needs you. It changes nothing by itself; each fix has an exact preview. Its eleven checks:

| # | Check | Codes |
| --- | --- | --- |
| 1 | Required properties missing (including `created`, listed as *estimated* when taken from the file's creation time) | `missing-id`, `missing-created`, `missing-required` |
| 2 | Values outside their rules (enum, min/max, pattern, type, format); a `section` or `track` not starting with the domain; a property the domain removed | `value-enum`, `value-type`, `value-min`, `value-max`, `value-pattern`, `value-format`, `value-link`, `value-heading`, `domain-prefix`, `removed-property`, `domain-folder`, `invalid-yaml` |
| 3 | IDs: duplicate, malformed or old-style `id`; a missing, mismatched, malformed or duplicate `unique_id` | `duplicate-id`, `malformed-id`, `old-id`, `id-year`, `missing-unique-id`, `unique-id-mismatch`, `malformed-unique-id`, `duplicate-unique-id` |
| 4 | Tag synonyms, unknown tags, tags typed in the body that are not in the vocabulary | `tag-synonym`, `tag-unknown`, `body-tag-synonym`, `body-tag-unknown` |
| 5 | `name` that does not match the file name | `name-mismatch` |
| 6 | A missing, odd or unmapped `breadcrumb` (always a warning) | `no-breadcrumb`, `odd-breadcrumb`, `breadcrumb-unmapped` |
| 7 | Notes on an older schema version (migration) or a newer one (read-only) | `old-schema`, `newer-schema` |
| 8 | A leftover `domain` or `domain_path` text from schema 1 (only when the type does not define `domain`) | `leftover-domain` |
| 9 | `created` later than `modified`; an ID or `created` that looks changed outside the plugin | `created-after-modified`, `id-changed`, `created-changed` |
| 10 | Folders whose names differ only by case | `folder-case` |
| 11 | Problems in the schema files themselves | `folder-conflict` and the codes below |

Fixes that change a note are available only while Rubric is on; adding a vocabulary term and accepting a known ID change schema files or plugin data, so they work either way. If the note changed since the scan, nothing is written and you are told to run the check again.

## Schema problem codes

The settings page and the vault check list schema problems as `file:line message`. **Errors** stop the pack loading (the last good copy stays in use); **warnings** load.

**Files and registry**

| Code | Meaning |
| --- | --- |
| `file-missing` | A file named in the registry does not exist (error). A missing `folders.yaml` or `scope.yaml` is a warning |
| `yaml-syntax` | The file is not valid YAML |
| `registry-shape` | The registry or one of its entries has the wrong shape |
| `format`, `format-newer` | `format` missing, or newer than this plugin understands |
| `plugin-too-old` | `min_plugin_version` is newer than the running plugin |
| `type-prefix`, `type-version` | A type prefix is not two capital letters or is used twice; a version is not a whole number from 1 |
| `module-shape`, `type-shape` | A module or type file is not a map |
| `type-uses`, `unknown-module` | A type lacks `uses` or `base`, or names a module that does not exist |
| `name-mismatch` | A file says another name than the registry (a warning for modules and vocabularies) |
| `folders-mode`, `folders-shape`, `folders-unknown-type`, `folders-order`, `folder-conflict` | Problems in `folders.yaml`; `folders-order` and `folder-conflict` are warnings |
| `scope-mode`, `scope-shape` | Problems in `scope.yaml` |
| `domains-shape`, `domains-name`, `domains-folder`, `domains-default` | Problems in `registry/domains.yaml`: not a map or no domains, a name that is not a slug, a folder that is not one name or is used twice, a default that is not listed. A bad or repeated prefix is `prefixes` |
| `domains-missing` | A property takes its values from `registry/domains.yaml`, which does not exist |
| `module-requires` | A type uses a module without a module it requires |
| `module-empty` | A module file has no properties |

**Body access**

| Code | Meaning |
| --- | --- |
| `body-shape` | `body` in a type file is not a map, or `body.enabled` is not true or false (error) |
| `body-unknown-key` | A key under `body` other than `enabled`. It has no effect (a warning) |

**Properties**

| Code | Meaning |
| --- | --- |
| `properties-shape`, `property-shape` | `properties` or a property is not a map |
| `unknown-value-type` | `type` is not one of the value types |
| `list-items` | A list has no valid `items` |
| `enum-values`, `values-from`, `values-from-type` | An enum has no values, `values_from` is wrong, or a type does not give the values `values_from: type` needs |
| `number-limit`, `pattern`, `boolean-attribute`, `managed-by`, `position` | An attribute has a bad value |
| `prefixes` | A domain prefix is not two capital letters, is used twice, is for a value the property does not have, or is on the property as well as in the registry |
| `bad-default` | A default is not valid for its property |
| `duplicate-property` | Two modules, or a module and a type, define the same property |
| `overrides-shape`, `override-unknown` | The type's `overrides` is malformed, or names a property the type does not have |
| `vocabulary-missing`, `vocabulary-unknown`, `vocabulary-shape`, `vocabulary-clash` | A list of terms has no vocabulary or an unknown one; a vocabulary file is malformed; a word is used for two terms |
| `type-conflict` | A property name has different value types in different types or domains |
| `unique-id-prefixes` | A type has `unique_id` but no domain has a prefix |
| `unknown-attribute` | An attribute the plugin does not know (a warning) |

**Domain override files**

| Code | Meaning |
| --- | --- |
| `override-domain-unknown` | A file for a domain that is not registered. When no domains are defined at all it is one error naming the first file and the count, not one per file |
| `domain-missing`, `domain-mismatch` | The file does not say `domain: <slug>`, or says another |
| `override-shape`, `override-unknown-key` | The file or an entry has the wrong shape, or an unknown key |
| `override-type` | An override tries to change a property's `type` |
| `override-values` | `values` on a property that is not an enum |
| `override-unknown`, `remove-unknown` | Naming a property the type (or module) does not have |
| `override-conflict` | One property under two verbs in one file |
| `remove-core` | Removing a core property |
| `add-exists` | Adding a property the type already has |
| `sections-unknown`, `section-duplicate` | `sections` in a module without a `section` property, or a section already in the default list |
| `domain-prefix` | A `section` value or `track` term without the `<domain>-` prefix |
| `vocab-collision` | A domain term or synonym that equals a default one (the default wins) |

## Recipes

| Goal | Steps |
| --- | --- |
| A new note type | Add `types/<name>.yaml` with `type`, `uses` (must include `base`) and `properties`; add it to `registry/types.yaml` with a unique two-letter `prefix` and `version: 1`; map a folder in `registry/folders.yaml` |
| A new status value | Append it to the type's `overrides.status.values`. Keep the default valid |
| A new property for every type | Put it in a module that all types use (for example `findability`), or add the module to each type's `uses` |
| A required property that new notes fill themselves | `required: true` plus `default:` |
| Controlled tags with synonyms | Terms in `vocabularies/tags.yaml`; the property needs `type: list`, `items: term`, `vocabulary: tags`, `strict: true`, `normalise: true` |
| Different `kind` values in one domain | `types/kb/<domain>.yaml` with `override: { kind: { values: [...], default: ... } }` |
| A field only one domain needs | `types/<type>/<domain>.yaml` with `add:` |
| Drop a field in one domain | `remove: [name]` (not a core property) |
| Per-domain sections | `modules/curriculum/<domain>.yaml` with `sections: [<domain>-...]` and optionally `override: { section: { default: <domain>-... } }` |
| Per-domain tags or tracks | `vocabularies/tags/<domain>.yaml`, `vocabularies/tracks/<domain>.yaml` (tracks start with `<domain>-`) |
| Move a note to another domain | Change its `domain` and accept the new `unique_id`. If you keep notes in domain folders, move the file yourself (the plugin never moves files); if only the folder changed, **Check vault** offers to set the domain to match |
| A domain with no unique IDs | Leave out its `prefix` in `registry/domains.yaml` |
| Notes of a domain in a differently named folder | `folder:` in its registry entry |
| Stop the plugin acting while you write the schema | Turn Rubric off (status bar, settings, or the command). Check vault still works |

## Limits worth knowing

- Locks are advisory. Nothing stops another tool changing a locked property; the vault check reports it.
- Comments inside a note's frontmatter may be lost when the plugin rewrites it. Put explanations here, in the schema files.
- The Properties-area features (hold Option for the list, the ▾ button, autocomplete in the property field) use undocumented Obsidian internals and may stop working after an Obsidian update; the commands and the picker window do not.
- Mobile is not supported. The body access layer avoids desktop-only code so that it can run there later, but this has not been tried.
- Body access has no features yet, and it follows Obsidian's own idea of a heading, which differs from CommonMark in places (a line of text over `---` is a heading only when it is a single line).
- The plugin never deletes data, never moves or renames files, and never writes `breadcrumb` unless you turn that on.
