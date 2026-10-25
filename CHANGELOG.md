# Changelog

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
