# Frozen pack for the rule tests

A copy of the starter schema pack as it was when the rules were written. The unit tests (`tests/*.test.ts`), the real-app
suite (`scripts/e2e.mjs`) and the performance script load **this** pack, so the rules are tested against a stable schema
and the shipping pack in `schema-pack/` can change without touching them. The shipping pack has its own tests
(`tests/shipped-pack.test.ts`, `tests/embedded-pack.test.ts`). Change this folder only to test a new rule.
