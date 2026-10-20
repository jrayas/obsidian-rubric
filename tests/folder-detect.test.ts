import { describe, expect, it } from 'vitest';
import { detectSchemaFolder, isInSchemaFolder } from '../src/core/folder-detect';

describe('schema folder detection', () => {
  it('uses _schema by default', () => {
    expect(detectSchemaFolder('_schema', ['Notes', '_schema'])).toEqual({ folder: '_schema', exists: true, hidden: false, warnings: [] });
  });

  it('uses .schema when it is the setting and flags it as hidden', () => {
    const r = detectSchemaFolder('.schema', ['Notes', '.schema']);
    expect(r).toMatchObject({ folder: '.schema', exists: true, hidden: true, warnings: [] });
  });

  it('uses the one named in settings and warns about the other when both exist', () => {
    const r = detectSchemaFolder('_schema', ['_schema', '.schema']);
    expect(r.folder).toBe('_schema');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('.schema');
    const r2 = detectSchemaFolder('.schema', ['_schema', '.schema']);
    expect(r2.folder).toBe('.schema');
    expect(r2.warnings[0]).toContain('_schema');
  });

  it('reports not found and hints at the other default name', () => {
    const r = detectSchemaFolder('_schema', ['.schema']);
    expect(r.exists).toBe(false);
    expect(r.folder).toBe('_schema');
    expect(r.warnings[0]).toContain('.schema');
  });

  it('supports a custom name and matches case-insensitively', () => {
    expect(detectSchemaFolder('Rules', ['rules'])).toMatchObject({ folder: 'rules', exists: true });
    expect(detectSchemaFolder('Rules', ['_schema', '.schema'])).toMatchObject({ exists: false, warnings: [] });
  });

  it('treats an empty setting as the default', () => {
    expect(detectSchemaFolder('  ', ['_schema']).folder).toBe('_schema');
  });

  it('recognises paths inside the schema folder', () => {
    expect(isInSchemaFolder('_schema/types/kb.yaml', '_schema')).toBe(true);
    expect(isInSchemaFolder('_SCHEMA/x.md', '_schema')).toBe(true);
    expect(isInSchemaFolder('Notes/_schema/x.md', '_schema')).toBe(false);
  });
});
