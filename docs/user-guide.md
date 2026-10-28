# User guide

For someone installing and using Rubric. (Developers: start at [README.md](README.md).)

## Requirements and why

| Requirement | Reason |
| --- | --- |
| Obsidian 1.13.7 or later (desktop; phone and tablet in a lighter form) | The Properties-area technique the plugin relies on is documented by an existing community plugin as working from 1.13.7; settings use the declarative settings API that arrived in 1.13. Only 1.14.4 was available for testing |
| macOS or Windows for the full experience | The hold key and the Properties-area features need a desktop keyboard and Obsidian's desktop Properties area |
| iOS or Android (mobile-lite) | The manifest says `isDesktopOnly: false`. Schemas, matching, IDs, `modified`, the vault check, presets and export work; the Properties-area features are off. See [On a phone or tablet](#on-a-phone-or-tablet) |

## Install

1. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/rubric/`.
2. Settings → Community plugins → enable **Rubric** (turn off restricted mode if asked).
3. Run **Install starter schema pack** from the command palette. It lists the files it will create, asks, and never overwrites.

## The switch: Rubric starts off

On a fresh install Rubric is **off**, so you can write and change your schema before anything acts on your notes. The status bar shows **Rubric: off** (click it to turn it on); the same switch is in *Settings → Rubric → Switch* and in the command **Toggle automation on or off**. Rubric never turns itself on, and while it is off a notice at start-up reminds you.

| While it is off | |
| --- | --- |
| Never happens | `modified` stamps, filling or asking about new notes, the "which schema?" question, tag, status and type-change prompts, `name` and breadcrumb syncing, conversions, **Create note from schema**, **Convert this note**, **Choose schema for this note**, and fixes and migrations from **Check vault** that change a note |
| Still works | Loading and checking the schema files, the schema problems list and notices, **Check vault** (it only reads), option lists and autocomplete (they only suggest; picking a value is you editing the property), **Reload schemas**, the property previews, adding a term to a vocabulary, **Install starter schema pack** |

Turning it off also drops stamps and prompts that were waiting; a write already running finishes. Notes you change while it is off do not get a `modified` stamp, and nothing is asked afterwards about those changes: run **Check vault** after turning it on. If you installed an earlier version, your saved settings keep it **on**.

## The schema folder

`_schema/` at the vault root (or `.schema`, or a name you choose in settings). It holds:

| Path | Purpose |
| --- | --- |
| `registry/types.yaml` | The list of note types, their ID prefixes and schema versions |
| `registry/folders.yaml` | Matching mode and root folder → type |
| `registry/scope.yaml` | Which notes are managed |
| `modules/*.yaml` | Reusable groups of properties |
| `vocabularies/tags.yaml` | Controlled tags and their synonyms |
| `types/*.yaml` | One file per note type |
| `REFERENCE.md` | What every attribute means |

Edit these files in any editor. The plugin reloads them when they change (for a hidden `.schema` folder, within a few seconds, or run **Reload schemas**). If a file has a mistake you get one notice naming the file and line, the plugin keeps using the last good copy, and the settings page lists the problem. Fix the file and it recovers without a restart.

The plugin itself only ever writes `folders.yaml` and `scope.yaml` (when you change a mapping or a rule in settings, or answer the "which schema?" prompt), one term into the tags vocabulary (when you click *Add to vocabulary*), and the starter pack (when you run the install command). Comments in those files are kept.

## Which schema does a note use?

In this order, first match wins: a valid `type` in the note; the first segment of `breadcrumb` against the folder list in `folders.yaml`; the note's first folder (listed in `folders.yaml`, or named like a schema); otherwise you are asked once for that folder, with the choice "Leave unmanaged" and a tick box to remember the answer. "Not now" stops the question for that folder. A note in the vault root stays unmanaged until you use **Choose schema for this note**.

Names are compared ignoring case and accents. If two schemas claim the same folder, the settings page says so and asks you to pick the owner.

Notes outside the managed scope (the schema folder, anything excluded, or anything not included in include-only mode) get no suggestions, no picker, no checks, no prompts and no stamps.

## Editing properties

| You do | You get |
| --- | --- |
| Click a property and type | Suggestions from the note's schema. A synonym ("sop") shows its preferred term ("procedure"). Enter or Tab picks; Escape closes only the suggestions |
| Hold **Option** (Alt on Windows) on a focused property | After about a third of a second, every allowed value, with a tick on the current one. Click one to save it. Release: the list hides, unless the pointer is over it |
| Press your hotkey for **Show all options for this property** | The list stays open with a filter box. Arrows move, Enter picks, Space ticks or unticks (multi-select), each change saves at once. Escape (first press) or the same hotkey closes it |
| Click the ▾ button | The same list |
| Hold the key on `id`, `schema`, `breadcrumb`, `created`, `modified` | A note saying who manages it. These never open a list |

If the pointer is on the list when you let go of Option, the list stays so you can click; it closes after you pick a single value, or when the pointer leaves it, or on Escape or a click elsewhere. If the pointer is not on the list it hides at once. Turn on **Always hide the list on release** to hide it every time. If the key release is ever missed (for example the window lost focus), the list closes on the next mouse move or key press.

Typing a symbol with Option held (for example Option+G on a Mac) does not open the list: another key pressed during the hold cancels it.

Settings (*Settings → Rubric*): the hold key, the delay (default 330 ms), whether the list always hides on release, whether the focus hint shows, and **Commands only**, which turns all of this off while keeping the commands and the picker window.

In Source mode, the same suggestions appear after `key: ` and inside lists under a key.

## Naming a new note

A new note is not filled while you are still typing its title. Type the name and press Enter (or click away): the note is renamed first and then filled, so `name` is the name you typed. If you keep "Untitled", it is filled once you leave the title field.

## The property preview (`_schema/preview/`)

For each type the plugin writes a read-only file, for example `_schema/preview/kb.yaml`, showing exactly what a new note of that type starts with: the properties in order, their starting values, and after each one a comment saying what is allowed (for example the status values). Properties that are not written until used are listed below as comments. Where a **domain** changes a type, a second file, `_schema/preview/kb/pcb.yaml`, shows how a new note of that type starts in that domain, with a line saying what the domain adds, removes and changes. The files are generated from the schema and rewritten whenever the schema changes, so they never go stale; files for a type or domain that no longer exists are removed. Nothing is read back from them, so editing one has no effect (change the schema files instead). The folder is ignored by the schema reload. Turn it off with **Write property previews to the schema folder**.

## Domains and folders

A note's `domain` decides which override files apply to it. When a note has no domain, Rubric takes it from the folder: the first folder below the root that is a domain, so a note filled or created in `Knowledge/maths/` is in the maths domain and gets maths's section, kinds and unique ID prefix. **Create note from schema** lists each domain's folder (`Knowledge/maths`) for types that have a domain. Notes in other folders get `general`. **Check vault** warns when a note's folder and its `domain` disagree and offers to set the property to match; it never moves a file. See `_schema/REFERENCE.md`, *Where a note's domain comes from*.

## New notes, renames and moves (Automation settings)

| Setting | What it does | Default |
| --- | --- | --- |
| When a note is created in a mapped folder | **Fill automatically** adds `type`, `schema`, `id`, `name`, `status`, `created`, `modified` and the defaults; **Ask with a preview** shows them first; **Do nothing** leaves the note alone. Only new notes without an `id` are touched; notes that look like sync arrivals, notes with an ID and excluded folders are skipped | Ask with a preview |
| Wait before filling a new note | Time to let Obsidian's Templates plugin (or another plugin) finish first. Only missing properties are added; anything already written is never changed | 1500 ms |
| Keep the name property in step with the file name | After a rename, `name` follows the file name, but only if it was empty or filled by the plugin | On |
| Set breadcrumb from the folder | Writes the real folder path to `breadcrumb` when a note is created or moved. Only for people who do not use a breadcrumb plugin | Off |
| Ask about changes in | Open notes only, or every note (may ask about notes that arrived through sync) | Open notes only |
| Ask about tag synonyms / an invalid status / when the type changes / when the domain changes | Each prompt can be switched off | On |

Moving or renaming a note never changes `modified`. A move that changes the first breadcrumb segment to another schema still offers the conversion preview.

## Automatic changes

By default only one thing is written without asking: `modified`. Everything else shows what it will do and waits. The settings above can switch on silent filling of new notes, `name` following renames, and `breadcrumb` following the folder.

| It asks when… | What you see |
| --- | --- |
| A tag in a note is a synonym | Old → new, with **Replace** |
| A tag is not in the vocabulary | **Add to vocabulary** (one click) or **Cancel** |
| `status` is not one of the type's values | The allowed values as buttons |
| `type` is changed, or a move changes the breadcrumb's first segment | A preview of what is added with defaults and what is kept in `archived_fields`; **Convert** or **Not now** |
| Many notes move at once | One window for all of them, with progress |

These questions are asked for notes you have open. Obsidian cannot tell a change that arrives through sync from one you made, and notes that arrive through sync must never prompt, so notes you are not looking at are left for the **Check vault** report.

## IDs

`PREFIX-YYYY-NNNN`: NT note, KB kb, RS resource, PR project, TK task, EX exercise, SC scenario, EG example, JR journal, PE person, WK workout. The year comes from `created` and never changes; the number counts per type per year and restarts each January. IDs are locked and immutable. A converted note keeps its old ID.

Two notes with the same ID (for example created offline on two devices): the vault check keeps the ID on the older note and offers the newer one the next free number, with a preview. A renumbered ID is never given out again.

### Retired IDs

When a note is renumbered, or its unique ID is issued again, the old ID is retired so it is never handed out twice. The settings page lists them under **Retired IDs** and says for each whether it still holds a number back. The next number is one more than the highest used or retired number of that type and year, so releasing an ID helps only when it is that highest number; the list says so. Select the delete button to release one (it asks first), or use **Release all retired IDs**. Do this only if no note, link or outside record still refers to the ID.

### The unique ID (types with a domain)

A type that uses the `domain` module also has `unique_id`: `TYPE-DOMAIN-YEAR-NNNN`, for example `KB-MA-2026-0001` (a knowledge note in maths). It is separate from `id`, which stays the one global identity and never changes. The unique ID is a readable label with its own counter per type, domain and year, so "the 42nd maths lesson this year" is easy to see. Each domain's two-letter prefix is declared in `registry/domains.yaml` (`maths: { prefix: MA }`); a domain with no prefix gets no unique ID.

- New notes get one when they are created or filled, from the note's domain.
- When a note's **domain** changes (or its **type**, in a conversion), the plugin offers to issue it again, with a preview. The old value is kept in `archived_fields` and never handed out again. Turn the question off with **Ask when the domain changes**.
- **Check vault** reports a missing unique ID, one that names another type or domain, a malformed one (never overwritten), and duplicates (the older note keeps it).
- Link to a note by its `id`, never by its unique ID, which can change.

## Schema presets and export

Under **Schema presets and export** in the settings (and as commands) you can keep named copies of your whole schema folder, try another one, and go back.

1. **Save the schema as a preset** and give it a name. Only the schema files are saved, not the generated previews and not your notes. Presets are stored in the plugin's own folder.
2. **Apply a preset**: select it under **Saved presets** (or run **Apply schema preset**). A window lists every file that will be added, replaced or removed. If you approve, your current schema is saved first as *Before applying “name” …*, then the schema folder is made to match the preset and the schemas reload. To undo, apply that backup preset.
3. **Export the schema as a zip** writes the schema folder to one zip in the top folder of your vault, to share or keep.

Nothing here changes a note, so it works with Rubric switched off.

## Timestamps

`created` is set once, in local time, as `2026-10-20T14:32`. `modified` is stamped about a second and a half after you stop changing a note. It does not change for a move, for a breadcrumb rewrite, or for the plugin's own writes. A change that arrives with a different `modified` already inside it (for example through sync) is accepted as it is. Local time has no timezone, so the hour when clocks go back is ambiguous; this is a known, accepted limit.

## Vault check

**Check vault** scans every managed note and lists, per note, what needs you. It changes nothing by itself. The eleven checks:

1. Required properties missing (including `created`, listed as *estimated* when taken from the file's creation time).
2. Values outside an enum list, a minimum or maximum, a pattern, or the wrong type or format.
3. Duplicate or malformed IDs; old-style IDs (`KB-000142`); an ID year that differs from `created` (a warning only).
4. Tag synonyms, unknown tags, and tags typed in the note body that are not in the vocabulary (body tags change only with your approval).
5. `name` that does not match the file name.
6. A missing `breadcrumb`, or one whose first segment maps to no schema (always a warning).
7. Notes still on an older schema version.
8. A leftover `domain` text property (removal is offered only when it repeats the breadcrumb).
9. `created` later than `modified`; an ID or `created` that looks changed outside the plugin (compared with a small local index of what was first seen).
10. Folders whose names differ only by case.
11. Schema problems: invalid files (with file and line), property type conflicts, two schemas claiming one folder.

Each fix is a button; the preview is the exact change. If the note changed since the scan, nothing is written and you are told to run the check again.

## Migration (schema 1 to 2)

The vault check offers it per note, and **Migrate all `<type>` notes** for several at once (one approval, progress shown). It renames old IDs to the year format, turns the nested `source`, `review`, `contact`, `met`, `muscles`, `progress` and `recurrence` blocks into flat properties (`source_title`, `review_cycle`, …), removes `domain` and `domain_path` when they repeat the breadcrumb, keeps `created` and `modified` and moves them last, and sets `schema` to 2. Anything a flat property cannot hold, and a `domain` that does not repeat the breadcrumb, is kept in `archived_fields`.

## Create a note

**Create note from schema**: pick a type, a name and a folder. The name must work on both macOS and Windows (no `/ \ : * ? " < > |`, no trailing dot or space, no reserved names like `CON`). The note gets an ID, `created`, `modified` and every default. The plugin never writes `breadcrumb`.

## On a phone or tablet

Rubric loads on iOS and Android in a lighter form (version 0.5.0 onwards).

**Works:** reading and checking your schema files, the problem list, matching and scope, readable IDs, `modified` stamping, **Check vault** with its previews and fixes, retired IDs, schema presets, the zip export, and Source-mode suggestions for property values.

**Different or off:** there is no hold key, no ▾ button and no autocomplete inside the Properties area, and the settings that belong to them are hidden. To pick a value, run **Choose a property to edit** (or **Show all options for this property** with nothing focused): choose the property, then the value, and it is saved at once. Add the command to Obsidian's mobile toolbar in *Settings → Mobile* for one tap. The status bar item does not exist on mobile; use the settings page or the command **Toggle automation on or off**.

**Also different:** to save phone battery and memory Rubric does not read every note when the app starts. A note gets its `modified` baseline when you open it, so an edit you make there is stamped; a change that arrives through sync is not stamped on the phone (the device that made it stamps it). **Check vault** reads every note and can take a while on a large vault. **Open schema folder** shows the folder name instead of opening a file manager.

**Not verified:** layout at real phone widths, touch gestures, a hidden `.schema` folder on mobile, large vaults, and the zip export's file hand-off (the zip is written to the top folder of the vault; use your file app or a sync tool to take it elsewhere).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Nothing happens: no `modified`, no prompts, no filling | Is Rubric on? The status bar says **Rubric: off** when it is off (see "The switch") |
| No suggestions on a property | Is the note in scope and matched to a schema? Is **Commands only** on? Is the property in the type's schema? |
| One notice: "Properties area features are unavailable" | This Obsidian version changed the internals the layer needs. Use the commands and the picker window. Report the Obsidian version |
| "Schema problem in …" | The notice names the file and line; the plugin is using the last good copy |
| A hidden `.schema` folder does not reload | Use **Reload schemas**; hidden folders are checked every few seconds but not by Obsidian |
| `modified` did not change | Moves, breadcrumb-only edits, edits in excluded folders, notes without plugin properties, and the **Stamp modified silently** setting all skip it |
| A prompt did not appear | Prompts are for notes open in a pane (see "Automatic changes"); use **Check vault** |

## Limits

- Locks are advisory. The vault check reports changes; it does not prevent them.
- On a phone or tablet only the lighter feature set below works; it has been tried in Obsidian's mobile emulation on a Mac, not on a real device.
- The Properties-area features depend on undocumented internals and may stop working after an Obsidian update; the commands and the picker window do not.
- Not verified: Windows (including that Alt does not move focus to the menu bar), Obsidian 1.13.7, the real breadcrumb plugin, real sync between devices, hidden-folder sync.
