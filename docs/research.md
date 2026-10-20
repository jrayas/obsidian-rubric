# Study of existing plugins (P0.5)

Done 2026-10-20 from the community directory pages and by probing the real Obsidian 1.14.4 internals. Source code of the two plugins was not read line by line; the technique below is confirmed by the directory description and by reproducing it in the isolated app (see `unknowns.md`, U1).

## Better Properties (unxok)

- Source: https://github.com/unxok/obsidian-better-properties, docs https://better-properties.unxok.com, MIT, minimum Obsidian 1.9.14, desktop and mobile.
- Adds new property types and per-property settings ("validation, display, and behavior for each property").
- Does **not** read schemas from files, match notes to types, generate IDs or stamp timestamps. The directory page does not mention autocomplete from a controlled vocabulary.

**Reuse:** nothing at runtime (it is a different design: settings live in its own UI, not in YAML files). **Avoid:** overlapping its generic "new property types" features. **Still needed here:** everything schema-driven (matching, scope, controlled tags, IDs, timestamps, migration, vault check).

**Coexistence:** both plugins can register property widgets. Because this plugin decorates whatever widget Obsidian (or another plugin) already chose (D-09), it does not fight Better Properties; it adds behaviour on top of the widget in use.

## Nested Frontmatter Properties (copperbox)

- Source: https://github.com/copperbox/obsidian-nested-frontmatter-properties, minimum Obsidian 1.13.7 (the same minimum as this plugin).
- Renders nested objects and arrays of objects in the Properties panel.
- Technique, as described by the directory page: registers a widget in `app.metadataTypeManager.registeredTypeWidgets` and wraps `metadataTypeManager.getTypeInfo` (using `monkey-around`) so values the stock UI marks unsupported resolve to its widget. Every internal access is feature-detected; if the internals change the plugin deactivates and stock behaviour returns. Writes go through `processFrontMatter`.

**Reuse (technique only):** the registry plus `getTypeInfo` wrap, with feature detection and automatic deactivation.
**Avoid:** relying on a new widget type per property (it would assign types by property name for all notes). We wrap `getTypeInfo` and return a *decorated copy of the widget Obsidian already picked*, so notes without a schema are unaffected.
**Still needed:** per-note decisions (the widget receives `sourcePath` at render time), hold-to-show and latched list behaviour, schema-sourced option lists.

## Other relevant plugins seen in the search (not studied)

Nested Properties (mnaoumov), Extended Properties, Metadata Menu. Not needed for the first version; Metadata Menu is the closest "schema in a file" design but uses its own field model rather than plain YAML note schemas.

## Conclusion

The technique is feasible and has a working precedent at the same minimum version. The plan keeps it behind one file with a kill switch and a commands-and-picker path that needs no internals.
