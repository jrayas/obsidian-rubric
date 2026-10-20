import { describe, expect, it } from 'vitest';
import { checkScope } from '../src/core/scope';
import type { ScopeConfig } from '../src/core/schema-types';

const def: ScopeConfig = { mode: 'exclude', exclude: ['Templates', 'Archive', 'Attachments'], include: [] };

describe('scope (rule 2)', () => {
  it('includes every note by default', () => {
    const none: ScopeConfig = { mode: 'exclude', exclude: [], include: [] };
    expect(checkScope('Anything/x.md', none, '_schema')).toEqual({ managed: true });
    expect(checkScope('root.md', none, '_schema')).toEqual({ managed: true });
  });

  it('excludes the listed folders and everything below them', () => {
    expect(checkScope('Templates/a.md', def, '_schema')).toEqual({ managed: false, reason: 'excluded' });
    expect(checkScope('Archive/2024/old/a.md', def, '_schema')).toEqual({ managed: false, reason: 'excluded' });
    expect(checkScope('Notes/a.md', def, '_schema')).toEqual({ managed: true });
  });

  it('compares whole folder names, not prefixes', () => {
    expect(checkScope('Archived/a.md', def, '_schema').managed).toBe(true);
    expect(checkScope('Archive.md', def, '_schema').managed).toBe(true);
  });

  it('ignores case and accents in rules', () => {
    expect(checkScope('templates/a.md', def, '_schema').managed).toBe(false);
    expect(checkScope('Tëmplates/a.md', def, '_schema').managed).toBe(false);
  });

  it('supports nested folder rules', () => {
    const s: ScopeConfig = { mode: 'exclude', exclude: ['Projects/Archive'], include: [] };
    expect(checkScope('Projects/Archive/x.md', s, '_schema').managed).toBe(false);
    expect(checkScope('Projects/Active/x.md', s, '_schema').managed).toBe(true);
    expect(checkScope('Other/Projects/Archive/x.md', s, '_schema').managed).toBe(true);
  });

  it('always excludes the schema folder, whatever the mode', () => {
    expect(checkScope('_schema/types/kb.yaml', def, '_schema')).toEqual({ managed: false, reason: 'schema-folder' });
    const inc: ScopeConfig = { mode: 'include-only', exclude: [], include: ['_schema'] };
    expect(checkScope('_schema/readme.md', inc, '_schema').managed).toBe(false);
    expect(checkScope('.schema/x.md', def, '.schema').managed).toBe(false);
  });

  it('include-only manages just the listed folders', () => {
    const inc: ScopeConfig = { mode: 'include-only', exclude: [], include: ['Knowledge', 'Projects'] };
    expect(checkScope('Knowledge/a/b.md', inc, '_schema').managed).toBe(true);
    expect(checkScope('Tasks/a.md', inc, '_schema')).toEqual({ managed: false, reason: 'not-included' });
    expect(checkScope('root.md', inc, '_schema').managed).toBe(false);
  });

  it('exclude always wins over include', () => {
    const inc: ScopeConfig = { mode: 'include-only', exclude: ['Knowledge/Drafts'], include: ['Knowledge'] };
    expect(checkScope('Knowledge/a.md', inc, '_schema').managed).toBe(true);
    expect(checkScope('Knowledge/Drafts/a.md', inc, '_schema')).toEqual({ managed: false, reason: 'excluded' });
  });

  it('ignores the include list when the mode is exclude', () => {
    const s: ScopeConfig = { mode: 'exclude', exclude: [], include: ['Knowledge'] };
    expect(checkScope('Tasks/a.md', s, '_schema').managed).toBe(true);
  });
});
