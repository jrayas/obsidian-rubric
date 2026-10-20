# Log (append-only)

- 2026-10-20 23:00 — Read the spec, both skills and their references. Spec approval gates overridden by the brief (D-01).
- 2026-10-20 23:20 — Node was missing; unpacked checksum-verified Node 24.22.0 into .tools/ (D-03). npm install of pinned toolchain OK.
- 2026-10-20 23:35 — Debug harness written; launched isolated Obsidian 1.14.4; fixed an argument-parsing bug in scripts/debug.mjs; `eval` works.
- 2026-10-20 23:40 — Phase 0 experiments U1-U8 run in the real app; results in docs/unknowns.md. Found processFrontMatter breaks CRLF (D-07).
- 2026-10-20 23:45 — docs/ and tracking/ created. Tests run: none yet (no code).
- 2026-10-20 23:38 — Phase 1 done. Unit tests: 49 passed (schema-pack, schema-loader, folder-detect, embedded-pack). lint/typecheck/build clean. CDP on Obsidian 1.14.4: install command created 19 files; breaking modules/review.yaml kept last good pack and showed one notice naming file:line; fixing it recovered with no restart; hidden .schema folder loaded and poll detected break and fix within 3.5 s. Console: no errors.
