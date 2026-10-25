import { stringify } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { newNoteFrontmatter, planCompletion } from '../src/core/create';
import { domainFromFolder, typeFor } from '../src/core/domain-overrides';
import { readFrontmatter } from '../src/core/frontmatter';
import { applyFixToText, checkNote, makeAllocator, makeUniqueAllocator } from '../src/core/note-check';
import type { CheckContext, NoteInput } from '../src/core/note-check';
import type { ResolvedType, SchemaPack } from '../src/core/schema-types';
import { nextUniqueId } from '../src/core/unique-id';
import { load, shippedFiles } from './helpers/pack';

let pack: SchemaPack;
beforeAll(async () => {
  pack = (await load(shippedFiles())).pack as SchemaPack;
});
const NOW = new Date(2026, 9, 25, 9, 0);

describe('the domain a folder names', () => {
  const domains = ['general', 'maths', 'physics', 'pcb', 'embedded'];
  it('is the first folder below the root that is a domain', () => {
    expect(domainFromFolder(domains, 'Knowledge/maths/Limits.md')).toBe('maths');
    expect(domainFromFolder(domains, 'Exercises/pcb/Size a capacitor.md')).toBe('pcb');
    expect(domainFromFolder(domains, 'Knowledge/maths/algebra/Groups.md')).toBe('maths'); // deeper folders do not matter
    expect(domainFromFolder(domains, 'Knowledge/pcb/maths/Odd.md')).toBe('pcb'); // the first one wins
  });

  it('ignores case and accents in the folder name', () => {
    expect(domainFromFolder(domains, 'Knowledge/Maths/Limits.md')).toBe('maths');
    expect(domainFromFolder(['général'], 'Knowledge/GENERAL/x.md')).toBe('général');
  });

  it('is nothing for a note directly in its root, in a folder that is not a domain, or when the root itself is the domain', () => {
    expect(domainFromFolder(domains, 'Knowledge/Limits.md')).toBeUndefined();
    expect(domainFromFolder(domains, 'Knowledge/Problems/x.md')).toBeUndefined();
    expect(domainFromFolder(domains, 'maths/Limits.md')).toBeUndefined(); // the root folder is the type's, not a domain
    expect(domainFromFolder(domains, 'Limits.md')).toBeUndefined();
    expect(domainFromFolder([], 'Knowledge/maths/Limits.md')).toBeUndefined();
  });

  it('a folder that is not a declared domain is not one', () => {
    expect(domainFromFolder(domains, 'Knowledge/chemistry/x.md')).toBeUndefined();
  });
});

describe('a note is completed with its folder’s domain', () => {
  const alloc = (tp: string, dp: string, y: number) => nextUniqueId(tp, dp, y, []);
  const kbIn = (domain: string) => typeFor(pack, 'kb', domain) as ResolvedType;

  it('gets the domain, that domain’s section default and kinds, and a unique ID with its prefix', () => {
    const plan = planCompletion({}, kbIn('maths'), { name: 'Limits', now: NOW, allocateId: () => 'KB-2026-0001', allocateUnique: alloc, domain: 'maths' });
    expect(plan.added.domain).toBe('maths');
    expect(plan.added.section).toBe('maths-foundations');
    expect(plan.added.kind).toBe('definition');
    expect(plan.added.unique_id).toBe('KB-MA-2026-0001');
    expect(plan.added).not.toHaveProperty('audience'); // maths removes it
  });

  it('without a folder domain it is general, as before', () => {
    const plan = planCompletion({}, kbIn('general'), { name: 'N', now: NOW, allocateId: () => 'KB-2026-0001', allocateUnique: alloc });
    expect(plan.added.domain).toBe('general');
    expect(plan.added.section).toBe('general-start-here');
    expect(plan.added.unique_id).toBe('KB-GE-2026-0001');
  });

  it('a note that already has a domain keeps it, whatever the folder says', () => {
    const plan = planCompletion({ domain: 'pcb' }, kbIn('pcb'), { name: 'N', now: NOW, allocateId: () => 'KB-2026-0001', allocateUnique: alloc, domain: 'maths' });
    expect(plan.added).not.toHaveProperty('domain');
    expect(plan.added.unique_id).toBe('KB-PC-2026-0001');
  });

  it('every domain’s section default belongs to that domain', () => {
    for (const d of pack.domains) {
      const plan = planCompletion({}, kbIn(d), { name: 'N', now: NOW, allocateId: () => 'KB-2026-0001', allocateUnique: alloc, domain: d });
      expect(String(plan.added.section).startsWith(`${d}-`), d).toBe(true);
    }
  });

  it('create-from-schema gives the same result for the same folder', () => {
    const fm = newNoteFrontmatter(kbIn('physics'), { name: 'N', id: 'KB-2026-0001', now: NOW, domain: 'physics', allocateUnique: alloc });
    expect(fm.domain).toBe('physics');
    expect(fm.section).toBe('physics-mechanics');
    expect(fm.unique_id).toBe('KB-PY-2026-0001');
  });
});

describe('the vault check and the folder', () => {
  const ctx = (): CheckContext => ({ pack, now: NOW, usedIds: [], usedUniqueIds: [], retiredIds: [], known: {} });
  const note = (path: string, domain: string, extra: Record<string, unknown> = {}): NoteInput => {
    const t = typeFor(pack, 'kb', domain) as ResolvedType;
    const fm = newNoteFrontmatter(t, { name: 'N', id: 'KB-2026-0001', now: NOW, domain, allocateUnique: (tp, dp, y) => nextUniqueId(tp, dp, y, []) });
    return { path, basename: 'N', text: `---\n${stringify({ ...fm, ...extra }, { lineWidth: 0 })}---\nbody\n`, ctime: 0, type: t };
  };
  const run = (n: NoteInput) => checkNote(ctx(), n, makeAllocator([], []), makeUniqueAllocator([], []));

  it('is quiet when the folder and the domain agree, or the folder names no domain', () => {
    expect(run(note('Knowledge/maths/N.md', 'maths')).map((f) => f.code)).not.toContain('domain-folder');
    expect(run(note('Knowledge/N.md', 'pcb')).map((f) => f.code)).not.toContain('domain-folder');
    expect(run(note('Knowledge/Problems/N.md', 'pcb')).map((f) => f.code)).not.toContain('domain-folder');
  });

  it('warns when they disagree, and the fix sets the domain to the folder’s', () => {
    const f = run(note('Knowledge/maths/N.md', 'pcb')).find((x) => x.code === 'domain-folder');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toContain('“maths” folder');
    expect(f?.message).toContain('“pcb”');
    const fixed = readFrontmatter(applyFixToText(f?.baseText as string, note('Knowledge/maths/N.md', 'pcb').type, f?.fixes[0] as never));
    expect(fixed?.domain).toBe('maths');
  });

  it('does not apply to a type with no domain', () => {
    const task = pack.types.get('task') as ResolvedType;
    const n: NoteInput = { path: 'Tasks/maths/T.md', basename: 'T', text: '---\ntype: task\nschema: 2\nid: TK-2026-0001\nname: T\nstatus: todo\ncreated: 2026-10-01T09:00\nmodified: 2026-10-01T09:00\n---\n', ctime: 0, type: task };
    expect(run(n).map((f) => f.code)).not.toContain('domain-folder');
  });
});
