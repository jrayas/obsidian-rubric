import { beforeAll, describe, expect, it } from 'vitest';
import { bodyGate } from '../src/core/body-gate';
import type { GateInput } from '../src/core/body-gate';
import { checkScope } from '../src/core/scope';
import type { ResolvedType } from '../src/core/schema-types';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';
import { loadWith } from './helpers/pack';

let task: ResolvedType;
let kb: ResolvedType;
beforeAll(async () => {
  const r = await loadWith({ 'types/task.yaml': (t) => `${t}\nbody:\n  enabled: true\n` });
  task = r.pack?.types.get('task') as ResolvedType;
  kb = r.pack?.types.get('kb') as ResolvedType;
});

const scope = { mode: 'exclude' as const, exclude: ['Templates'], include: [] };
const ok = (over: Partial<GateInput> = {}): GateInput => ({
  masterOn: true,
  allowBodyEdits: true,
  verdict: checkScope('Tasks/a.md', scope, '_schema'),
  type: task,
  frontmatter: { schema: task.version },
  ...over,
});

describe('bodyGate', () => {
  it('allows a managed note of an opted-in type when both switches are on', () => {
    expect(bodyGate(ok())).toEqual({ allowed: true, type: task });
  });

  it('refuses with the first failing rule, in a fixed order', () => {
    expect(bodyGate(ok({ masterOn: false, allowBodyEdits: false }))).toEqual({ allowed: false, reason: 'rubric-off' });
    expect(bodyGate(ok({ allowBodyEdits: false }))).toEqual({ allowed: false, reason: 'body-edits-off' });
    expect(bodyGate(ok({ verdict: checkScope('Templates/a.md', scope, '_schema'), type: null }))).toEqual({ allowed: false, reason: 'unmanaged' });
    expect(bodyGate(ok({ type: null }))).toEqual({ allowed: false, reason: 'no-type' });
    expect(bodyGate(ok({ type: kb }))).toEqual({ allowed: false, reason: 'type-not-enabled' });
  });

  it('keeps the schema folder out whatever the scope says', () => {
    expect(bodyGate(ok({ verdict: checkScope('_schema/types/task.yaml', scope, '_schema') }))).toEqual({ allowed: false, reason: 'unmanaged' });
  });

  it('treats a note on a newer schema as read-only', () => {
    expect(bodyGate(ok({ frontmatter: { schema: task.version + 1 } }))).toEqual({ allowed: false, reason: 'newer-schema' });
    expect(bodyGate(ok({ frontmatter: undefined })).allowed).toBe(true);
  });
});

describe('body settings', () => {
  it('are off by default, also for settings saved by an older version', () => {
    expect(DEFAULT_SETTINGS.allowBodyEdits).toBe(false);
    expect(DEFAULT_SETTINGS.debugBodyAccess).toBe(false);
    expect(mergeSettings({ schemaFolder: '_schema', stampModified: true }).allowBodyEdits).toBe(false);
    expect(mergeSettings(null).allowBodyEdits).toBe(false);
  });

  it('are read back when saved, and a wrong type is ignored', () => {
    expect(mergeSettings({ enabled: true, allowBodyEdits: true, debugBodyAccess: true })).toMatchObject({ allowBodyEdits: true, debugBodyAccess: true });
    expect(mergeSettings({ allowBodyEdits: 'yes' }).allowBodyEdits).toBe(false);
  });
});
