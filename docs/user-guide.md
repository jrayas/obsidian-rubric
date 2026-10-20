# User guide

For someone installing and using Vault Schema. (Developers: start at [README.md](README.md).)

## Requirements and why

| Requirement | Reason |
| --- | --- |
| Obsidian desktop 1.13.7 or later | The Properties-area technique the plugin relies on is documented by an existing community plugin as working from 1.13.7; settings use the declarative settings API that arrived in 1.13. Only 1.14.4 was available for testing |
| macOS or Windows | Mobile has no hold-key and a different Properties area. The manifest says `isDesktopOnly: true` |

## Install

1. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/vault-schema/`.
2. Settings → Community plugins → enable **Vault Schema** (turn off restricted mode if asked).
3. Run **Install starter schema pack** from the command palette. It lists the files it will create, asks, and never overwrites.

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

Typing a symbol with Option held (for example Option+G on a Mac) does not open the list: another key pressed during the hold cancels it.

Settings (*Settings → Vault Schema*): the hold key, the delay (default 330 ms), whether the list always hides on release, whether the focus hint shows, and **Commands only**, which turns all of this off while keeping the commands and the picker window.

In Source mode, the same suggestions appear after `key: ` and inside lists under a key.

## Automatic changes

Only one thing is written without asking: `modified`. Everything else shows what it will do and waits.

| It asks when… | What you see |
| --- | --- |
| A tag in a note is a synonym | Old → new, with **Replace** |
| A tag is not in the vocabulary | **Add to vocabulary** (one click) or **Cancel** |
| `status` is not one of the type's values | The allowed values as buttons |
| `type` is changed, or a move changes the breadcrumb's first segment | A preview of what is added with defaults and what is kept in `archived_fields`; **Convert** or **Not now** |
| Many notes move at once | One window for all of them, with progress |

These questions are asked for notes you have open. Obsidian cannot tell a change that arrives through sync from one you made, and notes that arrive through sync must never prompt, so notes you are not looking at are left for the **Check vault** report.

## IDs

`PREFIX-YYYY-NNNN`: NT note, KB kb, PR project, EX exercise, JR journal, PE person, RS resource, TK task. The year comes from `created` and never changes; the number counts per type per year and restarts each January. IDs are locked and immutable. A converted note keeps its old ID.

Two notes with the same ID (for example created offline on two devices): the vault check keeps the ID on the older note and offers the newer one the next free number, with a preview. A renumbered ID is never given out again.

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

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No suggestions on a property | Is the note in scope and matched to a schema? Is **Commands only** on? Is the property in the type's schema? |
| One notice: "Properties area features are unavailable" | This Obsidian version changed the internals the layer needs. Use the commands and the picker window. Report the Obsidian version |
| "Schema problem in …" | The notice names the file and line; the plugin is using the last good copy |
| A hidden `.schema` folder does not reload | Use **Reload schemas**; hidden folders are checked every few seconds but not by Obsidian |
| `modified` did not change | Moves, breadcrumb-only edits, edits in excluded folders, notes without plugin properties, and the **Stamp modified silently** setting all skip it |
| A prompt did not appear | Prompts are for notes open in a pane (see "Automatic changes"); use **Check vault** |

## Limits

- Locks are advisory. The vault check reports changes; it does not prevent them.
- Mobile is not supported.
- The Properties-area features depend on undocumented internals and may stop working after an Obsidian update; the commands and the picker window do not.
- Not verified: Windows (including that Alt does not move focus to the menu bar), Obsidian 1.13.7, the real breadcrumb plugin, real sync between devices, hidden-folder sync.
