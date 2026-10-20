# Vault Schema Plugin: Specification for Claude Code

Oct 20, 2026 · @Joan Anthirayas

## Purpose and scope

This is the specification for an Obsidian desktop plugin, for Mac and Windows, that reads note schemas from a folder in the vault and uses them to drive property autocomplete, option pickers, validation and migration. Claude Code owns the plan and the implementation. This spec contains no code and does not dictate internals; it fixes behaviour, data and rules, and Claude Code decides how to build them.

**In scope**

- A schema folder (`_schema` by default) that the plugin loads and hot-reloads.
- Matching each note to a schema, with include and exclude rules.
- Autocomplete and an all-options dropdown in the Properties area, opened by holding Option (Alt on Windows) or by a latched hotkey.
- Readable IDs, controlled tags, locked fields, `created` and `modified` timestamps.
- Silent fixes, prompts, a vault check and schema migration with a diff preview.
- A settings page.

**Out of scope for the first version**

- Mobile.
- A kanban board layer (later, on top of Obsidian's own Bases kanban view).
- An in-app schema editor (schemas are edited as plain YAML files).
- Compliance controls such as approvals, access control and audit history.
- Writing the `breadcrumb` field or moving files: the user's separate breadcrumb plugin owns both.

**Terms used in this spec**

| Term | Meaning |
| --- | --- |
| Schema folder | The vault folder holding the registry, modules, vocabularies and types |
| Module | A reusable group of fields that note types compose from |
| Type | A note kind (kb, project, task and so on) built from modules plus its own fields |
| Registry | The files that list types, folder mappings and scope rules |
| Breadcrumb plugin | The user's existing plugin that writes the `breadcrumb` property and moves notes |

**How Claude Code should use this document**

1. Read the whole spec before planning.
2. Write a plan with phases and tasks before writing code, using the work list in this spec as the starting point.
3. Where the spec and Obsidian's real behaviour disagree, stop and report it instead of guessing.

## Settled decisions

These choices are final for the first version. Do not reopen them without asking.

| Area | Decision |
| --- | --- |
| Schema folder | `_schema` by default; `.schema` supported as an option; the name is a setting |
| Schema format | Plain YAML files; the plugin hot-reloads them and validates them on load |
| Composition | Modular: each type lists the modules it uses, then adds its own fields |
| Matching order | 1) a valid `type` in the note, 2) first segment of `breadcrumb` against the registry folder list, 3) folder name equal to a schema name, 4) otherwise ask once and remember |
| Scope | Every note is included by default; exclude rules and include-only mode; exclude always wins; the schema folder is always excluded |
| Location | Only the `breadcrumb` property, a text value that always starts with the root folder, written by the breadcrumb plugin and only read by this plugin |
| Removed ideas | No `domain` list, no `domain_path`, no domains vocabulary |
| IDs | Readable: type prefix, creation year, running number, for example `KB-2026-0143`; no counter file |
| Duplicate IDs | Caught by the vault check; the older note keeps the ID and the newer one gets the next free number; renumbered IDs are never reused |
| Timestamps | `created` and `modified` are real frontmatter fields, always last, local time `YYYY-MM-DDTHH:mm` with no timezone |
| Modified rule | Any change to the file counts, including changes that arrive through sync; moves, breadcrumb rewrites and this plugin's own fixes do not count |
| Properties area | Normal click gives autocomplete; holding Option (Alt on Windows) shows all options; a hotkey latches the list open until Escape or the same hotkey |
| Locked fields | `id`, `breadcrumb`, `created`, `modified` never open a picker |
| Automation | Silent only for stamping `modified`; everything else asks first, with a diff for migrations |
| Nested fields | Flattened where a person edits them; stakeholders become links to person notes; milestones become task notes |
| Type change | When a move changes the first breadcrumb segment, prompt to convert; fields that no longer apply are kept in an archived block, never deleted |
| Schema errors | Keep using the last good copy of a schema and show a warning |
| Platforms | Mac and Windows desktop; mobile out of scope; set a minimum Obsidian version |
| Compliance | Described as governance-ready, not as a compliance system |

## Architecture

The plugin sits between a folder of YAML schemas and the user's notes: it reads the schemas, shapes how properties are edited, and reacts to changes in the vault.

```
  _schema/ (YAML files)            THE PLUGIN                        NOTES IN THE VAULT
 ┌─────────────────────┐ reads  ┌────────────────────────┐ shapes ┌────────────────────┐
 │ registry/           │───────►│ 1 Loader + validator   │        │ frontmatter        │
 │ modules/            │        │ 2 Matcher + scope      │───────►│ properties         │
 │ vocabularies/       │        │ 3 Autocomplete         │        │ IDs, tags, status  │
 │ types/              │        │ 4 Option dropdown      │        │ created / modified │
 └─────────────────────┘        │ 5 Write queue          │        └─────────┬──────────┘
          ▲                     │ 6 Prompts + vault check│                  │
          │ hot reload          │ 7 Migration + diff     │◄─────────────────┘
   user edits a schema file     │ 8 Settings page        │   watches changes
                                └───────────▲────────────┘
                                            │ reads only
                                ┌───────────┴────────────┐
                                │ BREADCRUMB PLUGIN      │
                                │ (separate, user-owned) │
                                │ writes `breadcrumb`    │
                                │ moves notes            │
                                └────────────────────────┘
```

**Responsibilities by part**

| Part | Job |
| --- | --- |
| 1 Loader and validator | Reads the schema folder, checks every file, keeps the last good copy on error, reloads on change |
| 2 Matcher and scope | Decides whether a note is managed and which schema it uses |
| 3 Autocomplete | Suggests values from the note's schema as the user types in a property |
| 4 Option dropdown | Shows all allowed values while Option or Alt is held, or latched by hotkey |
| 5 Write queue | The only place that changes a note's frontmatter; one queued write per note |
| 6 Prompts and vault check | Asks before changes that alter meaning; scans the vault for problems |
| 7 Migration and diff | Upgrades notes between schema versions and shows the change first |
| 8 Settings page | All options, schema folder status and the folder mapping |

**Boundary with the breadcrumb plugin**

```
  breadcrumb plugin                     this plugin
  ─────────────────                     ───────────
  moves the file               ──┐
  writes `breadcrumb`            ├──►   reads `breadcrumb` after it changes
  include / exclude, drag, by    │      re-matches the schema if the first
  domain or by file options    ──┘      segment changed, then prompts

  this plugin NEVER moves a file and NEVER writes `breadcrumb`.
```

## Vault and schema folder layout

The schema lives in one folder at the vault root, split by concern, and notes live in root folders that map to schemas.

```
MyVault/
├── _schema/                       name is a setting: _schema (default) or .schema
│   ├── registry/
│   │   ├── types.yaml             type list, versions, ID prefixes, module and vocabulary paths
│   │   ├── folders.yaml           matching mode, order, and root folder -> schema list
│   │   └── scope.yaml             include / exclude rules
│   ├── modules/
│   │   ├── base.yaml              type, schema, id, name, status, created, modified
│   │   ├── findability.yaml       aliases, description, keywords, tags, language
│   │   ├── taxonomy.yaml          breadcrumb
│   │   ├── relations.yaml         parent, related, supersedes, superseded_by
│   │   ├── provenance.yaml        source_title, source_author, source_url, source_accessed
│   │   └── review.yaml            review_cycle, review_last, review_next
│   ├── vocabularies/
│   │   └── tags.yaml              controlled tags with synonyms
│   ├── types/
│   │   ├── note.yaml   kb.yaml   project.yaml   exercise.yaml
│   │   └── journal.yaml   person.yaml   resource.yaml   task.yaml
│   └── REFERENCE.md               what every schema attribute means
│
├── Notes/            -> note
├── Knowledge/        -> kb          (Wiki/ also maps to kb)
│   └── Physics/
│       └── Quantum Mechanics/
│           └── Wave-Particle Duality.md
├── Projects/         -> project
├── Exercises/        -> exercise
├── Journal/          -> journal
├── People/           -> person
├── Resources/        -> resource
├── Tasks/            -> task
├── Templates/        excluded
├── Archive/          excluded
└── Attachments/      excluded
```

**Rules for the folder**

- If both `_schema` and `.schema` exist, use the one named in settings and warn about the other.
- The plugin must read the schema folder even when it is hidden (a name starting with a dot), because Obsidian does not index hidden folders.
- Schema files are plain YAML, edited outside Obsidian or through a command that opens the file in the default editor.
- There is no state folder and no counter file. IDs are worked out from the notes themselves.
- The schema format itself has a version number so future changes can be migrated.

## Schema pack: modules, types and properties

Every note type is a list of modules plus a few fields of its own, and every property has a type, rules and allowed values defined once in the schema files.

**Property value types**

| Type | Meaning |
| --- | --- |
| string | Free text |
| integer | Whole number, optional minimum and maximum |
| boolean | true or false |
| date | `YYYY-MM-DD` |
| datetime | `YYYY-MM-DDTHH:mm`, local time, no timezone |
| url | A web address |
| link | A quoted wiki-link such as `"[[Note]]"`; some fields also allow a heading, `"[[Note#Heading]]"` |
| enum | Exactly one of a fixed list of values |
| list | Several values of one type (string, link, url or controlled term) |

**Module: base** (every type uses it)

| Property | Type | Rules |
| --- | --- | --- |
| `type` | enum of type names | Required. Offered from the registry. Changing it triggers the convert prompt |
| `schema` | integer | Required. Version the note was written against. Set by the plugin. Locked |
| `id` | string | Required. Format `PREFIX-YYYY-NNNN`, for example `KB-2026-0143`. Immutable. Locked. Set by the plugin |
| `name` | string | Required. Should match the file name; a mismatch is a warning |
| `status` | enum | Required. Allowed values and default come from the type |
| `created` | datetime | Required. Set once at creation. Immutable. Locked. Always last in the order |
| `modified` | datetime | Required. Updated by the rules in the Rules section. Locked. Always last in the order |

**Module: findability**

| Property | Type | Rules |
| --- | --- | --- |
| `aliases` | list of string | Default empty |
| `description` | string | One line, shown in search |
| `keywords` | list of string | Free text, not controlled |
| `tags` | list of controlled terms | From the tags vocabulary. Strict. Synonyms are replaced by the preferred term. Unknown tags are flagged |
| `language` | enum | `en-GB` (default), `en-US`, `fr`, `de`, `es` |

**Module: taxonomy**

| Property | Type | Rules |
| --- | --- | --- |
| `breadcrumb` | string | Folder path only, separated by `/`, starting with the root folder, no leading or trailing slash, never the note's own name, for example `Knowledge/Physics/Quantum Mechanics`. Written by the breadcrumb plugin. Read only here. Locked. Warn if the first segment maps to no schema |

**Module: relations**

| Property | Type | Rules |
| --- | --- | --- |
| `parent` | link | Index or hub note |
| `related` | list of link | Default empty |
| `supersedes` | list of link | Default empty |
| `superseded_by` | link | Optional |

**Module: provenance** (flattened, so the Properties area can edit it)

| Property | Type | Rules |
| --- | --- | --- |
| `source_title` | string |  |
| `source_author` | string |  |
| `source_url` | url |  |
| `source_accessed` | date |  |

**Module: review**

| Property | Type | Rules |
| --- | --- | --- |
| `review_cycle` | enum | `none`, `1-month`, `3-months`, `6-months` (default), `yearly` |
| `review_last` | date |  |
| `review_next` | date |  |

**Types**

Each type's field order is: its modules in the order listed, then its own fields, then `created` and `modified`.

| Type | Modules | Status values (default first) | Own properties |
| --- | --- | --- | --- |
| note | base, findability, taxonomy, relations | draft, in-progress, evergreen, archived | `confidence` enum low, medium (default), high |
| kb | base, findability, taxonomy, relations, provenance, review | draft, review, published, outdated, archived | `kind` enum concept (default), how-to, reference, troubleshooting, faq; `audience` enum self (default), team, public; `confidence` enum low, medium (default), high |
| project | base, findability, taxonomy, relations | planning, idea, active, on-hold, done, cancelled | `priority` integer 1 to 5, default 3; `start` date; `deadline` date; `outcome` string; `stakeholders` list of links to person notes |
| exercise | base, findability, taxonomy, relations | draft, tested, reliable, archived | `category` enum mobility (default), strength, stability, cardio, skill; `kind` enum find-it, drill, stretch, lift, flow; `measure` enum time, reps, distance, load, quality; `equipment` list of string; `muscles_primary` list of string; `muscles_secondary` list of string; `technique` link with heading; `mistakes` link with heading |
| journal | base, findability, relations | open, closed | `date` date, required; `period` enum daily (default), weekly, monthly, yearly; `mood` integer 1 to 5; `energy` integer 1 to 5; `location` string; `highlights` list of string |
| person | base, findability, relations | active, dormant, archived | `relationship` enum friend, family, colleague, client, mentor, other; `organisation` string; `role` string; `location` string; `birthday` date; `last_contacted` date; `follow_up` date; `contact_email` string; `contact_phone` string; `contact_website` url; `contact_social` list of url; `met_date` date; `met_where` string |
| resource | base, findability, taxonomy, relations | to-consume, in-progress, done, abandoned | `resource_type` enum book, article, video, podcast, course, paper, tool, required; `creator` string; `url` url; `published` date; `rating` integer 1 to 5; `takeaways` link; `progress_percent` integer 0 to 100, default 0; `progress_started` date; `progress_finished` date |
| task | base, findability, relations | todo, doing, waiting, done, cancelled | `priority` integer 1 to 5, default 3; `project` link; `context` string; `effort` string; `scheduled` date; `due` date; `completed` date; `depends_on` list of link; `recurrence_rule` string; `recurrence_until` date |

Milestones are not a property. Each milestone is a task note whose `project` link points to the project.

**Example: a knowledge note**

```yaml
---
type: kb
schema: 2
id: KB-2026-0143
name: Wave-Particle Duality
status: draft
aliases: [wave particle duality]
description: Why light and matter show both wave and particle behaviour.
keywords: [double slit, de Broglie]
tags: [quantum, theory]
language: en-GB
breadcrumb: Knowledge/Physics/Quantum Mechanics
parent: "[[Quantum Mechanics]]"
related: ["[[Double-Slit Experiment]]"]
source_title: Lectures on Physics
source_author: Richard Feynman
source_accessed: 2026-10-20
review_cycle: 6-months
review_last: 2026-10-20
review_next: 2027-04-20
kind: concept
audience: self
confidence: medium
created: 2026-10-20T14:32
modified: 2026-10-21T09:05
---
```

**Example: a task note**

```yaml
---
type: task
schema: 2
id: TK-2026-0012
name: Review contract
status: doing
aliases: []
tags: [policy]
language: en-GB
priority: 2
project: "[[Contract Renewal]]"
due: 2026-10-24
depends_on: []
created: 2026-10-18T10:15
modified: 2026-10-20T16:40
---
```

**Schema attributes the plugin must understand**

| Attribute | Meaning |
| --- | --- |
| `type`, `items` | Value type, and the item type for lists |
| `required`, `default` | Must be present; value used when creating |
| `values` | Allowed values for an enum |
| `min`, `max` | Limits for an integer |
| `pattern` | A text pattern the value must match |
| `vocabulary`, `strict`, `normalise` | Controlled list, reject unknown terms, rewrite synonyms |
| `locked` | Never opens a picker in the Properties area |
| `immutable` | Never changes after it is first written |
| `generated` | The plugin fills it in |
| `managed_by: external` | Another plugin writes it; this plugin only reads and checks it |
| `position: end` | Always sorts after every other property |
| `allow_heading` | A link may include a heading |
| `uses` (on a type) | The modules it is built from, in order |

## Rules

These rules are the behaviour Claude Code must implement and test; each one is written so it can be checked.

**1. Matching a note to a schema**

- Order, first match wins: a valid `type` in the note; then the first segment of `breadcrumb` against the registry folder list; then a first folder name equal to a schema name; otherwise ask.
- Comparison ignores case and normalises accented characters, so Mac and Windows names match.
- One schema may answer to several folders (for example `Knowledge` and `Wiki` both map to kb).
- If two schemas claim the same folder, warn and ask which one owns it. Never pick silently.
- When nothing matches, ask once which schema to use, with the choice "leave unmanaged", and offer to remember the folder. "Not now" leaves the note alone and does not ask again on every open.
- Only notes created or moved on this device can trigger that prompt. Notes that arrive through sync never do.
- A note in the vault root has no folder and no breadcrumb, so it stays unmanaged until the user picks a schema.

**2. Scope**

- Every note is included by default.
- Exclude rules list folders; include-only mode manages only the listed folders. Exclude always wins.
- The schema folder is always excluded.
- An excluded note gets no suggestions, no picker, no validation, no automation and no prompts.

**3. The breadcrumb contract**

- `breadcrumb` is written only by the breadcrumb plugin, on create and move, and by the user. This plugin never writes it and never moves files.
- The value is a folder path with `/` between names, starting with the root folder, with no leading or trailing slash and never the note's own name. It may be set by hand, by domain or by file, so it need not equal the real folder path. Do not warn about a difference between the two.
- This plugin reacts when the value changes: it re-reads it, re-matches the schema, and re-checks the note.
- If the first segment changes to a different schema, show the convert prompt (rule 8).
- A missing or odd breadcrumb is a warning, never an error. A note with no breadcrumb falls back to its folder name for matching.
- A change to the `breadcrumb` line alone never updates `modified`.

**4. Readable IDs**

- Format `PREFIX-YYYY-NNNN`, for example `KB-2026-0143`. Prefixes: NT note, KB kb, PR project, EX exercise, JR journal, PE person, RS resource, TK task.
- The year is the year in `created` and never changes. The number counts per type per year and restarts each January.
- To create an ID, find the highest number for that type and year in the vault and add one. There is no counter file.
- IDs are immutable and locked.
- The vault check flags duplicates. The older note (by `created`) keeps its ID; the newer one is offered the next free number, with a preview. A renumbered ID is never reused.
- Old IDs such as `KB-000142` are converted with a preview: the year comes from `created`, the number is kept, giving `KB-2026-0142`.
- If an ID's year differs from the year in `created`, warn only; never change it.

**5. Timestamps**

- `created` is set once, at creation, in local time as `YYYY-MM-DDTHH:mm`. It is immutable and locked. A note that arrives without it gets it once from the file's creation time, and the vault check lists it as estimated.
- `modified` uses the same format and is locked. Both are always the last two properties.
- `modified` updates when the content or properties of the file change, whatever the cause: an edit in Obsidian, another tool, or a changed copy arriving through sync.
- `modified` does not update for a file move, for a breadcrumb rewrite, or for this plugin's own writes.
- Guard against loops: stamp `modified` only when the file changed and its `modified` value did not. A change that arrives with a newer `modified` already inside it is accepted as it is and nothing is written. A change that arrives without a new `modified` is stamped with the local time.
- Stamp after a short pause once changes stop, not on every keystroke.
- Local time has no timezone, so the hour when clocks go back is ambiguous. This is a known and accepted limit.

**6. Tags**

- Tags come from the tags vocabulary. A synonym is replaced by its preferred term. An unknown tag prompts: add it to the vocabulary (one click) or cancel.
- Tags typed in the note body (such as `#idea`) are only reported by the vault check and are changed only with approval.

**7. Status**

- `status` is an enum whose allowed values and default come from the type.
- A value outside the list is a prompt with the allowed values as choices.

**8. Changing type**

- If the first breadcrumb segment, or the `type` property, changes to a different schema, show a preview: properties that will be added with their defaults, and properties that no longer apply.
- Properties that no longer apply are never deleted. Their values are kept in a locked property named `archived_fields` that records the old type, the date and the values.
- Nothing changes until the user approves.

**9. Writing to notes**

- All changes go through one write queue per note.
- Compare first and write only if a value actually changes. Batch all changes for a note into one write.
- Use Obsidian's own way of editing frontmatter, then check that the property order still holds (module order, then the type's own fields, then `created` and `modified`).
- Comments inside frontmatter do not survive a rewrite; explanations belong in the schema files.
- Keep each file's line endings; never convert them.
- Mark this plugin's own writes so it can ignore them, which prevents loops.

**10. Locks are advisory**

- Locked and immutable properties are not enforced by the file system. The plugin detects changes and reports them in the vault check; it does not claim to prevent them.

**11. Schema loading and errors**

- Validate every schema file when loading: valid YAML, known modules, known value types, enum defaults that exist in their lists.
- A property name must have the same value type in every type, because Obsidian keeps one type per property name across the vault. Check this on load.
- If a file is invalid, keep using the last good copy and show the problem in the settings page and in one notice.
- Reload when a schema file changes, and offer a manual "Reload schemas" command for hidden folders.

**12. Names and files**

- `name` should match the file name; a mismatch is a warning with a fix prompt.
- When creating a note, reject characters that are not allowed on either Mac or Windows in file names.
- Warn about two folders whose names differ only by case.

## Properties area behaviour

A normal click gives autocomplete, holding Option (Alt on Windows) shows every allowed value, and a hotkey latches the same list open until the user closes it.

**What the user sees on a note**

```
┌─ Properties ───────────────────────────────────────┐
│ type        kb                                     │
│ schema      2                              locked  │
│ id          KB-2026-0143                   locked  │
│ name        Wave-Particle Duality                  │
│ status      [ draft                      ▾ ]       │
│ tags        quantum  theory  [ + ]                 │
│ language    en-GB                                  │
│ breadcrumb  Knowledge/Physics/Quantum Mechanics    │
│                                       locked       │
│ kind        [ concept                    ▾ ]       │
│ ...                                                │
│ created     2026-10-20T14:32               locked  │
│ modified    2026-10-21T09:05               locked  │
└────────────────────────────────────────────────────┘
```

**Mode 1: autocomplete (click into a value)**

```
 status   dr█
          ┌──────────────┐
          │ draft        │      only matching values from the
          └──────────────┘      note's schema; synonyms resolve
                                to their preferred term
```

**Mode 2: hold Option (Alt on Windows) to show every option**

```
 click the value to edit        hold Option                    release Option
 ┌─ status ─────────┐         ┌─ status ─────────────┐       ┌─ status ─────────┐
 │ dr█              │  ────►  │ dr█              ▾   │ ────► │ review           │
 │ ┌──────────┐     │         │ ┌──────────────────┐ │       └──────────────────┘
 │ │ draft    │     │         │ │ ✓ draft          │ │        list hides; the
 │ └──────────┘     │         │ │   review   ◄click│ │        pick is saved
 └──────────────────┘         │ │   published      │ │
                              │ └──────────────────┘ │
                              └──────────────────────┘
```

**Mode 3: latched list opened by a hotkey**

```
 press hotkey ──► list opens and STAYS open

 ┌─ tags ───────────────────────────────┐
 │ ┌──────────────────────────────────┐ │
 │ │ [x] quantum                      │ │   type to filter
 │ │ [x] theory                       │ │   arrows move, Enter picks
 │ │ [ ] experiment                   │ │   Space ticks or unticks
 │ │ [ ] how-to                       │ │   each change saves at once
 │ │ Esc or the hotkey closes the list│ │
 │ └──────────────────────────────────┘ │
 └──────────────────────────────────────┘
```

**Rules for the three modes**

- Every list comes from the schema of the note's type, so a task offers task values and a kb note offers kb values.
- Single-choice fields (`status`, `kind`, `priority`): picking saves at once and moves the tick.
- Multi-select fields (`tags`): each click or Space press ticks or unticks and saves; the list stays open.
- Locked properties (`schema`, `id`, `breadcrumb`, `created`, `modified`, `archived_fields`) ignore Option and the hotkey and show a short note saying who manages them.
- Holding Option shows the list only after a short delay (default about a third of a second, adjustable). If another key is pressed during the hold, cancel it. This stops the list popping up when typing Mac symbols such as the copyright sign.
- While the list is open by holding Option, typing and arrow keys are not used (Option changes their meaning on a Mac). Use the mouse, or use the latched mode.
- If the pointer is over the list when Option is released, the list stays open until the user clicks elsewhere or presses Escape. Otherwise it hides at once. A setting makes it always hide on release.
- Latched mode: the hotkey opens the list, and the same hotkey or Escape closes it. The first Escape closes only the list; a second Escape leaves the field as usual.
- If the user holds Option and then presses the hotkey, the list becomes latched and stays after Option is released.
- The list belongs to the property being edited. Clicking into another property closes it.
- A small `▾` button on each field opens the same list for mouse and screen reader users.
- A short hint appears when a field with options is focused (setting, on by default).
- Option on Mac and Alt on Windows are the same modifier in the code. A setting allows choosing another key.

**How it is built, in layers (most stable first)**

1. Commands and hotkeys that open the same list in a small picker window. This works on any supported Obsidian version and is the primary path.
2. Autocomplete in source mode through Obsidian's supported editor suggestion mechanism.
3. A custom widget registered for schema-covered properties inside the Properties area. Obsidian has no public API for this; an existing community plugin does it through an internal registry. Treat it as undocumented and fragile.
4. Last resort: event listeners on the Properties panel's own elements, only if layer 3 is unavailable.

**Safety rules**

- At startup, check whether layers 3 and 4 work. If not, fall back to commands only and show one notice, with no errors.
- A "commands only" setting turns the Properties-area features off entirely.
- Every new Obsidian release is checked against the manual checklist in the Test plan.

## Automation, prompts, vault check and migration

The plugin acts silently only when stamping `modified`; every other change asks first, and migrations show a diff before anything is written.

**What is silent and what asks**

| Action | Silent or asks | Notes |
| --- | --- | --- |
| Stamp `modified` | Silent | Follows the timestamp rules; ignores moves, breadcrumb rewrites and own writes |
| Fill missing `created` | Asks in the vault check | Listed as estimated |
| Assign a missing ID | Asks | Shows the ID it will use |
| Replace a tag synonym | Asks | Shows old and new |
| Add an unknown tag to the vocabulary | Asks | One click |
| Fix an invalid status | Asks | Choices are the allowed values |
| Renumber a duplicate ID | Asks | Preview, newer note changes |
| Convert a note to another type | Asks | Preview of added and archived properties |
| Migrate to a new schema version | Asks | Diff preview |
| Remove a leftover `domain` text property | Asks | Offered only when it repeats the breadcrumb |

**Prompt for a folder with no schema**

```
┌──────────────────────────────────────────────┐
│ No schema for  Inbox/                        │
│ Which schema should this note use?           │
│                                              │
│   ( ) kb        ( ) project     ( ) task     │
│   ( ) journal   ( ) person      ( ) resource │
│   ( ) exercise  ( ) note                     │
│   ( ) Leave unmanaged                        │
│                                              │
│ [x] Remember:  Inbox/  ->  chosen schema     │
│                                              │
│              [ Apply ]   [ Not now ]         │
└──────────────────────────────────────────────┘
```

**Prompt for a type change after the first breadcrumb segment changes**

```
┌─ Convert "Review contract" from task to kb? ──────┐
│ Added with defaults:                              │
│   kind: concept   audience: self   confidence:... │
│ Kept in archived_fields (not deleted):            │
│   priority: 2   due: 2026-10-24   project: ...    │
│                                                   │
│            [ Convert ]   [ Not now ]              │
└───────────────────────────────────────────────────┘
```

**Vault check**

A command scans every managed note and reports in one window. It changes nothing without approval, and it never blocks the user.

Checks it must run:

1. Required properties missing (including `created`).
2. Values outside an enum list, outside a minimum or maximum, or not matching a pattern.
3. Duplicate or malformed IDs; ID year different from the `created` year.
4. Tag synonyms, unknown tags, and body tags that are not in the vocabulary.
5. `name` that does not match the file name.
6. A `breadcrumb` that is missing, or whose first segment maps to no schema.
7. Notes still on an older schema version.
8. A leftover `domain` text property from before.
9. Notes where `created` is later than `modified`, or where an ID or `created` looks changed outside the plugin (use a small local index of known IDs and first-seen creation times).
10. Folders whose names differ only by case.
11. Schema problems: invalid files, property type conflicts, two schemas claiming one folder.

```
┌─ Vault check ───────────────────────────────────────────────┐
│ 120 notes scanned · 3 need you                              │
│                                                             │
│ Capital Adequacy Notes     tag "sop" is a synonym of        │
│                            "procedure"   [ Replace ]        │
│                                                             │
│ Contract Review Checklist  no ID         [ Assign ID ]      │
│                            status "live" is not allowed     │
│                            [draft][review][published][...]  │
│                                                             │
│ Credit Risk Overview       schema 1 -> 2                    │
│                            - id: KB-000146                  │
│                            + id: KB-2026-0146               │
│                            + source_title: ...              │
│                            [ Apply migration ]              │
└─────────────────────────────────────────────────────────────┘
```

**Migration**

- A migration runs when a note's `schema` is lower than its type's version in the registry.
- It lists every change as a diff and writes nothing until the user approves; it can apply to one note or to all notes of a type.
- Migration for this first release (schema 1 to 2): rename old IDs to the year format; turn nested `source`, `review`, `contact`, `met`, `muscles`, `progress` and `recurrence` blocks into the flat properties; remove `domain` and `domain_path`; keep `created` and `modified` and move them last; set `schema` to 2.
- Where a flat property would lose information, keep the original value in `archived_fields`.
- Batch mode: when many notes change in a burst (for example a folder reorganisation), wait until changes settle, process them once, and show progress.
- Prompts: one prompt per folder, remembered; a batch window for many notes at once.

## Settings page

One settings page holds the schema folder, matching, scope, Properties-area behaviour and automation, and it shows any schema problems at the bottom.

```
┌─ Vault Schema ────────────────────────────────────────────────┐
│                                                               │
│  Schema folder                                                │
│    Name            [ _schema          ▾ ]  _schema / .schema  │
│                                            / custom           │
│    Status          ✔ found: 8 types · 6 modules · 1 vocab     │
│    [ Reload schemas ]      [ Open schema folder ]             │
│                                                               │
│  Matching                                                     │
│    Mode            (•) Combined  ( ) Auto  ( ) Manual         │
│    No match        [ Ask me                    ▾ ]            │
│    Remember my answer as a folder mapping         [x]         │
│                                                               │
│  Scope                                                        │
│    Mode            (•) Everything except excluded             │
│                    ( ) Only included folders                  │
│    Excluded        Templates ✕   Archive ✕   Attachments ✕    │
│                    [ + Add folder ]                           │
│    Included        (used only in "Only included" mode)        │
│                                                               │
│  Properties area                                              │
│    Click                 Autocomplete                         │
│    Hold Option / Alt     Show all options       [ Option/Alt ▾]│
│    Hold delay            [ 330 ] ms                           │
│    Hide list on release  [ ] always (default: only if the     │
│                              pointer is off the list)         │
│    Latched list hotkey   set in Obsidian > Hotkeys            │
│    Show hint on focus    [x]                                  │
│    Commands only         [ ]  turns off the Properties hooks  │
│                                                               │
│  Automation                                                   │
│    Stamp modified silently          [x]                       │
│    Batch mode when many notes change [x]                      │
│    Everything else always asks first  (not changeable)        │
│                                                               │
│  Folder mapping           (stored in registry/folders.yaml)   │
│    Knowledge, Wiki  ──►  kb         [ edit ] [ remove ]       │
│    Projects         ──►  project    [ edit ] [ remove ]       │
│    Tasks            ──►  task       [ edit ] [ remove ]       │
│    [ + Add mapping ]                                          │
│                                                               │
│  Problems   ✔ none   (schema errors, conflicts, bad YAML)     │
└───────────────────────────────────────────────────────────────┘
```

**Every setting and its default**

| Setting | Default | Notes |
| --- | --- | --- |
| Schema folder name | `_schema` | `.schema` or a custom name; warn if both `_schema` and `.schema` exist |
| Matching mode | Combined | Auto uses the breadcrumb and folder only; Manual means the user picks per note or folder |
| No match | Ask me | Or leave unmanaged |
| Remember answer | On | Adds the folder to `registry/folders.yaml` |
| Scope mode | Everything except excluded | Or include-only |
| Excluded folders | Templates, Archive, Attachments | The schema folder is always excluded and not listed |
| Included folders | Empty | Used only in include-only mode |
| Hold key | Option on Mac, Alt on Windows | Can be changed to another key |
| Hold delay | 330 ms | Adjustable |
| Hide list on release | Only when the pointer is off the list | Or always |
| Latched list hotkey | None assigned | Set in Obsidian's Hotkeys settings |
| Show hint on focus | On |  |
| Commands only | Off | When on, the Properties-area hooks are disabled |
| Stamp `modified` silently | On |  |
| Batch mode | On | Waits for a burst of changes to settle |

**Files the plugin may write in the schema folder**

- `registry/folders.yaml`: when the user remembers a mapping or edits one in settings.
- `registry/scope.yaml`: when the user edits exclude or include rules in settings.
- Nothing else. All other schema files are edited by the user as plain YAML.

**Commands the plugin must provide**

- Show all options for this property (latches the list; also the hotkey target).
- Check vault.
- Reload schemas.
- Open schema folder in the default editor.
- Choose schema for this note.
- Convert this note to another type.

## Cross-platform and compatibility

The plugin must behave the same on Mac and Windows desktop, and must degrade safely when Obsidian changes underneath it.

| Area | Requirement |
| --- | --- |
| Platforms | Mac and Windows desktop. Mobile is out of scope and the plugin should mark itself desktop-only |
| Modifier key | Option on Mac, Alt on Windows; one setting selects the key. Test that holding Alt on Windows does not move focus to a menu bar in Obsidian; if it does, document the alternative key |
| Folder names | Compare after normalising accented characters, so a name typed on one system matches the other |
| Case | Matching ignores case; warn about two folders that differ only by case |
| File names | When creating notes, reject characters not allowed on either Mac or Windows |
| Line endings | Keep each file's own line endings; never convert |
| Hidden schema folder | Read it directly even though Obsidian does not index folders starting with a dot; test how it syncs |
| Obsidian version | Set a minimum version in the plugin manifest. The Properties-area widget technique used by an existing community plugin lists 1.13.7 or later, so use at least that as the starting point and confirm in a real vault |
| Versions | Each note records its schema version; each schema declares the minimum plugin version it needs; an older plugin treats a newer note as read-only |
| Sync | Two devices may edit the same note; the timestamp loop guard in the Rules section applies. Notes that arrive through sync never trigger prompts |
| Bases | `created` and `modified` in the frontmatter appear in Bases as note properties, separate from the file's own created and modified times; both stay available |
| Failure | Any failure in the Properties-area layer falls back to commands only, with one notice and no repeated errors |

**Existing community work to study before building**

- Better Properties adds property types and per-property settings, including validation. Check what it already does so nothing is built twice.
- Nested Frontmatter Properties edits nested values in the Properties panel and shows the internal registry technique. Study it for the widget layer.
- Obsidian now has a kanban view in Bases (version 1.14.4, October 2026) and community Bases boards exist. A later board layer should supply schema values and rules underneath one of them instead of building a competing board.

## Known weaknesses and mitigations

These are the risks found while designing, with the agreed answer to each. Claude Code should build the mitigation, not just note the risk.

| Weakness | Agreed mitigation |
| --- | --- |
| Duplicate IDs when two devices create notes offline | Readable IDs with year and number; the vault check finds duplicates; the older note keeps its ID and the newer one gets the next free number; renumbered IDs are never reused |
| Properties-area hooks are undocumented and may break on an Obsidian update | Commands and a picker window are the primary path; the widget layer checks it can attach and falls back quietly; a "commands only" setting; a manual checklist for each release |
| The Properties panel cannot edit nested values | Flatten the properties people edit by hand; stakeholders become links to person notes; milestones become task notes; an existing nested-properties plugin may help but is not relied on |
| Frontmatter is rewritten on every write, which drops comments and can reorder keys | One write queue per note; compare first and write only on change; one write per note; check order afterwards; explanations live in the schema files |
| Dependence on the breadcrumb plugin | A written contract (Rules, section 3); a missing or odd breadcrumb is a warning; this plugin only reads it |
| Locked and immutable properties are only advisory | Detect and report in the vault check; never claim to prevent changes |
| Not a compliance system | Described as governance-ready; real audit history needs git or backups; a history module is a later option |
| A hidden schema folder is awkward | Default to a visible `_schema`; support `.schema` with a manual reload command; test sync |
| One breadcrumb per note is rigid | Cross-cutting subjects use tags and `related` links; batch mode handles folder reorganisations |
| A homegrown schema language costs effort | Keep the attribute set small; document every attribute in `REFERENCE.md`; version the schema format; validate on load; study existing plugins first |
| Local timestamps have no timezone | Accept it as a known limit; the loop guard prevents sync bounce; moving to timezone-aware times later would be a migration |
| Strict tags add friction | One-click add to the vocabulary; body tags only reported; property types must agree across all types |
| Prompt fatigue | One prompt per folder, remembered; "Not now" stays quiet; sync arrivals never prompt; batch window for many notes |
| Two devices on different plugin versions | Each note records its schema version; an older plugin treats newer notes as read-only |
| Scope creep | Build the first-version list in the Work list only; the board and in-app schema editor are later |

## Work list for Claude Code

Build in seven phases, each ending with something that can be tried in a real vault; do not start a phase until the previous one meets its "done when" column.

```
 Phase 0     Phase 1       Phase 2        Phase 3         Phase 4        Phase 5         Phase 6
 Plan and -> Schema    ->  Matching   ->  Properties  ->  Writes and ->  Vault check -> Hardening
 study        loader        and scope      area            automation     and migration   and release
   │            │              │              │               │               │              │
 plan +       loads and     right schema   dropdowns      IDs, modified,   scan + diff    Mac + Windows
 findings     validates     per note       work           tags, prompts    + migrate      tested
```

**Phase 0: plan and study**

| Task | Done when |
| --- | --- |
| Read this whole spec and write a plan with tasks, order and risks | The plan is written and shared before any code |
| Study Better Properties and Nested Frontmatter Properties | A short note says what already exists, what to reuse or avoid, and what is still needed |
| Try the unknowns in section 14 in a real vault | Each unknown has a recorded result: works, fails, or works with a limit |
| Choose project structure, build tooling and test approach | Written in the plan, with reasons |

**Phase 1: schema foundation**

| Task | Done when |
| --- | --- |
| Write the schema pack files exactly as described in sections 4 and 5, plus `REFERENCE.md` | Every module, type, vocabulary and registry file exists and parses |
| Detect the schema folder (`_schema`, `.schema` or custom) and handle both existing | The right folder is used and a warning appears if both exist |
| Load registry, modules, vocabularies and types and resolve each type (modules in order, then own fields, `created` and `modified` last) | Each type resolves to the property lists in section 5 |
| Validate on load, including property type conflicts and enum defaults | A bad file produces a clear problem message naming the file and line |
| Keep the last good copy on error; hot reload on change; manual reload command | Breaking a schema file does not break the plugin; fixing it restores it without a restart |

**Phase 2: matching and scope**

| Task | Done when |
| --- | --- |
| Implement the matching order (type, breadcrumb first segment, folder name, ask) | Each case in rule 1 behaves as written, on both case and accent variations |
| Implement scope: exclude, include-only, exclude wins, schema folder always excluded | Excluded notes get no suggestions, validation, automation or prompts |
| Folder mapping read and write in `registry/folders.yaml`; conflict warning | Remembering a mapping writes the file; two schemas on one folder warns |
| No-match prompt with remember and "Not now" | Asks once per folder, never for notes arriving through sync |
| Settings page: schema folder, matching, scope, folder mapping, problems | Matches the layout in section 9 |

**Phase 3: Properties area**

| Task | Done when |
| --- | --- |
| Commands and picker window for all options, single and multi-select | Works with no Properties-area hook at all |
| Autocomplete in source mode through the supported editor suggestion mechanism | Suggests schema values and resolves synonyms |
| Widget layer for schema-covered properties with feature detection and quiet fallback | Disabled cleanly when unavailable; "commands only" setting works |
| Hold Option (Alt on Windows) shows all options after the delay; release rules | Behaves as in section 7, including the pointer rule and cancel on another key |
| Latched hotkey: open, close with the same hotkey or Escape; Escape order | Behaves as in section 7 |
| Locked properties ignore the picker and show who manages them | `schema`, `id`, `breadcrumb`, `created`, `modified`, `archived_fields` never open a list |
| Focus hint and the `▾` button | Present and usable by keyboard and screen reader |

**Phase 4: writes and automation**

| Task | Done when |
| --- | --- |
| One write queue per note with compare-first, one write, order check, own-write marking | No loops; order always correct; unchanged notes are not rewritten |
| Create a note from a type: ID, `created`, defaults, status | New notes have a valid ID and all required properties |
| ID rules, including year, per-type numbering and duplicate detection | Rule 4 passes in tests, including two notes created at once |
| Stamp `modified` with the loop guard and the ignore list | Rule 5 passes, including a sync arrival with a newer value already inside |
| Tag synonym and unknown-tag prompts; one-click vocabulary add | Rule 6 passes |
| Status prompt for invalid values | Rule 7 passes |
| Convert-type prompt with `archived_fields` | Rule 8 passes and nothing is ever deleted |

**Phase 5: vault check and migration**

| Task | Done when |
| --- | --- |
| Vault check with all eleven checks and the report window | Each check finds a seeded problem and changes nothing without approval |
| Diff preview and approval flow for every fix | The preview matches exactly what is written |
| Migration from schema 1 to 2, one note or all of a type | Section 8 migration steps all work; originals kept where flattening would lose data |
| Batch mode for bursts of changes with progress | A folder rename of many notes is processed once |

**Phase 6: hardening and release**

| Task | Done when |
| --- | --- |
| Run the test plan on Mac and Windows | All items in section 13 pass or have a recorded limit |
| Set the minimum Obsidian version and mark the plugin desktop-only | In the manifest, with the reason in the docs |
| Write user documentation and a short release checklist | Another person could install and use the plugin from it |
| Package for installation | Installable in a clean vault |

**Later, not in the first version**

- A board layer that supplies schema values and move rules beneath an existing Bases kanban view.
- An in-app schema editor.
- Optional modules for ownership, classification, retention, approval and history.

## Test plan

Every rule has a test, and a short manual checklist runs on both Mac and Windows for each Obsidian release.

**Automated tests (use a test vault with seeded notes)**

| Area | What to test |
| --- | --- |
| Schema loading | Valid pack loads; invalid YAML keeps the last good copy; unknown module, bad enum default and property type conflict are each reported with the file name |
| Resolution | Each type produces the property list and order in section 5, with `created` and `modified` last |
| Matching | Type in note wins; breadcrumb first segment next; folder name next; otherwise ask; case and accent variations match; two schemas on one folder warn |
| Scope | Default includes everything; exclude wins over include; schema folder always excluded; excluded notes get nothing |
| IDs | Correct format; year from `created`; numbering per type per year; a new year restarts at 0001; duplicates detected; renumbering keeps the older note; old IDs convert correctly |
| Timestamps | Edit updates `modified`; move, breadcrumb-only change and own writes do not; a change arriving with a newer `modified` is not rewritten; a change without one is stamped; no loop |
| Tags | Synonym replaced after approval; unknown tag prompts; body tags only reported |
| Status | Invalid value prompts with allowed values |
| Type change | Preview correct; added defaults correct; old values land in `archived_fields`; nothing deleted |
| Write queue | Unchanged notes are not written; one write per note; order preserved; line endings preserved |
| Vault check | Each of the eleven checks finds a seeded problem and writes nothing until approved |
| Migration | Schema 1 to 2 diff is exact; flattening keeps original values where needed; batch mode processes a folder rename once |

**Manual checklist for each Obsidian release (Mac and Windows)**

1. The plugin loads with no errors in the console.
2. Click into a property: autocomplete shows schema values.
3. Hold Option (Alt): the full list appears after the delay and hides on release; a symbol typed with Option does not open it.
4. Press the latched hotkey: the list stays open; the same hotkey and Escape both close it; the first Escape closes only the list.
5. Locked properties ignore Option and the hotkey and show their note.
6. Single-choice pick saves and keeps the list open in latched mode; multi-select ticks save each change.
7. Switch on "commands only": the Properties-area features are off and the commands still work.
8. Edit a note: `modified` updates once after the pause and not again.
9. Move a note with the breadcrumb plugin: the breadcrumb changes, `modified` does not, and a first-segment change shows the convert prompt.
10. Edit a schema file: the plugin reloads it; break it: the last good copy stays in use and a warning shows.
11. Run the vault check on the test vault: results match the seeded problems.
12. Sync a changed note between the two machines: no prompt, no `modified` bounce.

**Windows-specific checks**

- Holding Alt does not move focus to a menu bar.
- A folder name typed with accents on Mac still matches on Windows.
- A file name with a character illegal on Windows is rejected on create.

## Items to verify and open questions

The design rests on a few facts that could not be confirmed from outside a real vault; Claude Code must test each one in Phase 0 and record the result before building on it.

**To verify in a real vault**

| Unknown | Why it matters | If it fails |
| --- | --- | --- |
| A custom widget can be registered for schema-covered properties in the Properties area, on the minimum Obsidian version | The Option and latched-list features depend on it | Fall back to event listeners, then to commands only |
| Holding Option on a Mac, and Alt on Windows, can be detected while a property field has focus | Hold-to-show depends on it | Use the latched hotkey as the main path |
| Holding Alt on Windows does not move focus to a menu bar | Hold-to-show would misbehave | Choose another key for Windows, or use commands only |
| A hidden `.schema` folder can be read, watched and synced | The folder name option depends on it | Default to visible `_schema` and require a manual reload for `.schema` |
| Bases treats `YYYY-MM-DDTHH:mm` in frontmatter as a date and time | Sorting and filtering by `created` and `modified` depend on it | Change the stored format after testing |
| Obsidian's frontmatter editing keeps the property order and values the plugin writes | The "last two properties" rule and compare-first writes depend on it | Rewrite the frontmatter block directly in a controlled way |
| A plugin can tell a user edit, a sync arrival and its own write apart | The `modified` rule and loop guard depend on it | Use content comparison instead of event type |
| The breadcrumb plugin writes only `breadcrumb`, always starting with the root folder | Matching depends on it | Treat other values as warnings and fall back to folder name |

**Open questions to answer with the owner**

1. What exact file name does the breadcrumb plugin use for its settings, and is a hook between the two plugins possible, or is reading the frontmatter the only link?
2. Does anyone besides the owner use the vault, now or later? If yes, the schema folder may need stricter validation and clearer errors.
3. Should the `type` property be editable in the Properties area, or only changed through the convert command?
4. Should the plugin offer to remove leftover `domain` text properties automatically in the vault check, or only report them?

**Decisions deliberately postponed**

- Timezone-aware timestamps (a migration if needed later).
- A history or audit module.
- Ownership, classification, retention and approval modules.
- A board layer and an in-app schema editor.

## Working instructions for Claude Code

Plan first, build in small verified steps, and stop to ask when the spec and reality disagree.

1. **Plan before code.** Produce the Phase 0 plan: tasks, order, risks, project structure and test approach. Share it and wait for approval before building.
2. **This is an Obsidian desktop plugin for Mac and Windows.** Follow Obsidian's plugin conventions and keep to publicly documented behaviour wherever possible. Where this spec relies on something undocumented (the Properties-area widget layer), isolate it behind a single layer that can be switched off.
3. **Work one phase at a time.** Do not start a phase until the previous one meets its "done when" column. Show the result at the end of each phase.
4. **Test the unknowns first.** Section 14 lists what must be tried in a real vault. Record each result in the plan.
5. **Change nothing without approval, except `modified`.** Every other change to a note asks first and shows a preview. Never delete data; keep old values in `archived_fields`.
6. **Never move files and never write `breadcrumb`.** Both belong to the user's breadcrumb plugin.
7. **Keep the schema files the single source of truth.** Behaviour should come from the schema files, so adding a type, a status value or a tag needs no code change.
8. **No scope creep.** Anything in "Later" or "Decisions deliberately postponed" is out of the first version. If something seems missing, list it in the plan and ask.
9. **Report disagreements.** If a rule here conflicts with how Obsidian actually behaves, stop, describe the conflict and propose options; do not guess.
10. **Keep documentation current.** `REFERENCE.md` and the user documentation change with the code.

**Definition of done for the first version**

- All phases 1 to 6 meet their "done when" column.
- The automated tests and the manual checklist pass on Mac and Windows.
- The plugin installs in a clean vault, loads the schema pack, and works with the breadcrumb plugin installed and with it absent.
- Breaking a schema file, an Obsidian update that removes the widget layer, and a sync conflict each leave the user's notes safe.
