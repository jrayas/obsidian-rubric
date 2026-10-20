# Release checklist

Run before every release. Platform-specific items are marked **Mac** or **Windows**; the Windows items have not been run (see `testing.md`) and must be run by a person on a Windows machine.

## Automated (this machine)

- [ ] `npm test` passes.
- [ ] `npm run typecheck` and `npm run lint` pass with no warnings (ESLint with the Obsidian rules, and stylelint on `styles.css`).
- [ ] `npm run build` produces `main.js`; no `eval`, `new Function`, `innerHTML`, `fetch`, `XMLHttpRequest` or `localStorage` in it (the e2e suite checks).
- [ ] `npm run e2e` passes in an isolated Obsidian (all checks).

## Manual checklist for each Obsidian release (Mac and Windows)

From the spec's test plan. Mark with the Obsidian version and platform.

1. [ ] The plugin loads with no errors in the console.
2. [ ] Click into a property: autocomplete shows schema values.
3. [ ] Hold Option (Alt): the full list appears after the delay and hides on release; a symbol typed with Option does not open it.
4. [ ] Press the latched hotkey: the list stays open; the same hotkey and Escape both close it; the first Escape closes only the list.
5. [ ] Locked properties ignore Option and the hotkey and show their note.
6. [ ] Single-choice pick saves and keeps the list open in latched mode; multi-select ticks save each change.
7. [ ] Switch on "commands only": the Properties-area features are off and the commands still work.
8. [ ] Edit a note: `modified` updates once after the pause and not again.
9. [ ] Move a note with the breadcrumb plugin: the breadcrumb changes, `modified` does not, and a first-segment change shows the convert prompt.
10. [ ] Edit a schema file: the plugin reloads it; break it: the last good copy stays in use and a warning shows.
11. [ ] Run the vault check on the test vault: results match the seeded problems.
12. [ ] Sync a changed note between the two machines: no prompt, no `modified` bounce.

**Windows only**

- [ ] Holding Alt does not move focus to a menu bar (if it does, document the alternative key; the **Hold key** setting can choose Shift, Control or Command/Windows).
- [ ] A folder name typed with accents on Mac still matches on Windows.
- [ ] A file name with a character illegal on Windows is rejected on create.

## Release

- [ ] `manifest.json` `version` bumped (`npm version patch`, which also updates `versions.json`); `minAppVersion` still accurate; `isDesktopOnly` is `true`.
- [ ] `docs/` and `tracking/` updated; `README.md` still true (commands, settings, limits, privacy).
- [ ] Commit, tag equal to the version with no `v`, push the tag. The `release` workflow builds and creates a **draft** release with `main.js`, `manifest.json`, `styles.css`; publish the draft.
- [ ] First release only: submit at https://community.obsidian.md and fix anything the automated review reports.

## Install test in a clean vault

- [ ] Create a new vault; copy only `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/vault-schema/`.
- [ ] Enable the plugin, run **Install starter schema pack**, create a note from a schema, hold Option on its status.
- [ ] Repeat with the breadcrumb plugin installed, and with it absent.
