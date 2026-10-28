# Changelog

## 0.3.0 (2026-10-28)

### Added
- **A body access layer (internal).** A small, tested foundation that lets later features read and edit the body of a note safely. **No body behaviour ships in this version**: nothing in Rubric edits a body yet, and with the new setting off, or no type opted in, Rubric behaves exactly as in 0.2.0.
  - *Reading*: the body, its lines and its heading tree with line ranges. Headings are found the way Obsidian finds them (not inside code fences, `$$` math, `%%` comments or indented code; setext headings count).
  - *Writing*: replace the body only if it is still what the caller read, change it with a function that sees it as it is at that moment, or insert whole lines at a heading (`start`, `end`, `after`, `before`). Every write is one atomic `vault.process`, never touches the frontmatter, keeps CRLF, writes nothing when nothing changes, and works on a note that is open with unsaved typing (both are kept; it is one undo step). `modified` is stamped afterwards as for your own typing (in an open note that stamp is its own undo step, as after typing).
  - *Handlers*: a keymap registered once lets code claim `Enter`, `Tab` or `Shift-Tab` in the body of an opted-in note. A handler sees the type, cursor line, list depth and section, and records edits as one undo step. It may only insert unless it is registered as allowed to rewrite. Handlers do not run during IME composition, with several cursors, in the frontmatter, or in a code fence, math block or comment.
- **`body:` in type files**, reserved and checked, with no behaviour yet: `body: { enabled: true }` opts a type in. A key other than `enabled` is the warning `body-unknown-key` (so a pack can name keys a later version understands); a `body` that is not a map, or an `enabled` that is not true or false, is the error `body-shape` and the last good copy stays in use. A type with no `body:` is off.
- **Setting "Allow Rubric to edit note bodies"** (off by default): the kill switch. Off, no handler runs and no body is written; reading is always allowed. A body is also only edited when Rubric is on, the note is managed (not excluded, not in the schema folder), its type has opted in and its schema is not newer than the plugin knows.
- **Setting "Log body access"** (off by default): logs which handler changed which note to the developer console and adds the command **Body access: show sections** (the active note's type, whether `body.enabled` is on, and its heading tree with line ranges).
- `schema-pack/REFERENCE.md` documents the `body` key, both problem codes, the settings and a "Body access" section.

### Upgrading
- `_schema/REFERENCE.md` in your vault is not overwritten (**Install starter schema pack** creates only missing files). To read the new section, delete that one file and run the command, or copy it from the repository.
- Not tested: Windows, mobile, Obsidian 1.13.7, a real input method (IME) composing in the editor, the real breadcrumb plugin and real sync.

## 0.2.0 (2026-10-25)

### Added
- **A master switch.** Rubric is **off** on a fresh install, so you can write your schema before anything acts on a note. While it is off nothing changes a note and nothing asks about one; loading the schema, Check vault (read only), option lists and the previews still work. Turn it on from the status bar, the settings page or the command **Toggle automation on or off**. Installs that already had saved settings stay on.
- **Domain overrides.** A note's `domain` selects extra files that adjust the schema without forking it: `override`, `add` and `remove` (and `sections` for a module), in a folder next to the default file (`types/kb/maths.yaml`), plus extra terms for vocabularies. Core properties cannot be removed, types cannot change, section and track values keep the domain prefix.
- **Domains are registered like types** in the optional `registry/domains.yaml`: a prefix, a folder and a description for each, and a default. `domain` and `unique_id` are their own module; modules can say `requires`. Packs without a registry work as before.
- **`unique_id`**, a readable ID within a domain (`KB-MA-2026-0001`) beside the global `id`. It is issued again, with a preview, when the domain or type changes; the old one is kept in `archived_fields`. A domain without a prefix gets none.
- **A note's domain from its folder.** `Knowledge/maths/` is the maths domain when a note is filled or created; Create note from schema offers the domain folders. Check vault warns when the folder and the property disagree.
- **Property previews** are now also written per domain (`preview/<type>/<domain>.yaml`).
- **Vault check:** missing, mismatched, malformed and duplicate unique IDs; a section or track of another domain; a property a domain removed; a note in another domain's folder.
- **`_schema/REFERENCE.md`** rewritten as a complete quick reference (every file, attribute, domain rule, error code and recipe), kept in step with the pack by tests.
- Clearer schema errors: an empty module is reported by name, and override files found while no domains exist are one error instead of one per file.

### Changed
- **The starter pack is rebuilt**: 11 types (note, kb, resource, project, task, exercise, scenario, example, journal, person, workout), 8 modules, 2 vocabularies and five example domains (general, maths, physics, pcb, embedded). `kb` carries the curriculum; `exercise` is now the learning question and the fitness type is `workout`; there is no breadcrumb property. The pack needs plugin 0.2.0.
- Check 8 and the schema 1 to 2 migration no longer treat a `domain` property that the schema defines as a leftover.

### Upgrading
- **Install starter schema pack** still creates only files that are missing and never overwrites, so a vault that already has a schema must merge `registry/types.yaml` by hand to adopt the new pack.
- Not tested: Windows, Obsidian 1.13.7, the real breadcrumb plugin and real sync between devices.

## 0.1.0 (2026-10-24)
First release.
