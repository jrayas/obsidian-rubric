import { describe, expect, it } from 'vitest';
import type { GateRefusal } from '../src/core/body-gate';
import { FakeVault } from './helpers/body-fake';

const FM = '---\ntype: task\nid: TK-1\n---\n';
const BODY = '# Top\nintro\n\n## Notes\nn1\n';

function setup(text = FM + BODY) {
  const v = new FakeVault();
  const file = v.put('Tasks/a.md', text);
  return { v, file, svc: v.service() };
}

describe('reading', () => {
  it('returns the body, its lines and its sections with file line numbers', async () => {
    const { svc, file } = setup();
    expect(await svc.getBody(file)).toBe(BODY);
    expect(await svc.getLines(file)).toEqual(['# Top', 'intro', '', '## Notes', 'n1']);
    const t = await svc.getSections(file);
    expect(t.firstBodyLine).toBe(4);
    expect(t.flat.map((s) => [s.text, s.line, s.end])).toEqual([['Top', 4, 9], ['Notes', 7, 9]]);
  });

  it('is never gated: every switch off, the body can still be read', async () => {
    const { v, svc, file } = setup();
    v.gate = () => ({ allowed: false, reason: 'rubric-off' });
    expect(await svc.getBody(file)).toBe(BODY);
    expect((await svc.getSections(file)).flat).toHaveLength(2);
    expect(v.processCalls).toBe(0);
  });

  it('reads a note with no frontmatter, and a frontmatter-only note', async () => {
    const v = new FakeVault();
    const a = v.put('a.md', '# H\ntext');
    const b = v.put('b.md', '---\na: 1\n---');
    const svc = v.service();
    expect((await svc.getSections(a)).firstBodyLine).toBe(0);
    expect(await svc.getBody(b)).toBe('');
    expect(await svc.getLines(b)).toEqual([]);
  });
});

describe('writing', () => {
  it('changes only the body and leaves the frontmatter byte for byte', async () => {
    const { v, svc, file } = setup('---\r\ntype: task\r\n# comment kept\r\nid: TK-1\r\n---\r\n# Top\r\nintro\r\n');
    const r = await svc.insertAtSection(file, 'Top', 'added', 'end', { by: 'test' });
    expect(r).toMatchObject({ status: 'written' });
    expect(v.texts.get(file.path)).toBe('---\r\ntype: task\r\n# comment kept\r\nid: TK-1\r\n---\r\n# Top\r\nintro\r\nadded\r\n');
  });

  it('editBody gives the function the body as it is at write time, not an older copy', async () => {
    const { v, svc, file } = setup();
    const seen: string[] = [];
    v.beforeProcess = () => v.texts.set(file.path, FM + BODY + 'typed meanwhile\n');
    const r = await svc.editBody(file, (b) => { seen.push(b); return b + 'mine\n'; }, { by: 'test' });
    expect(seen).toEqual([BODY + 'typed meanwhile\n']);
    expect(r.status).toBe('written');
    expect(v.texts.get(file.path)).toBe(FM + BODY + 'typed meanwhile\nmine\n');
  });

  it('setBody refuses with conflict when the body changed since the caller read it, and writes nothing', async () => {
    const { v, svc, file } = setup();
    const readBody = await svc.getBody(file);
    v.beforeProcess = () => v.texts.set(file.path, FM + BODY + 'someone else\n');
    const r = await svc.setBody(file, 'replacement\n', { by: 'test', expectedBody: readBody });
    expect(r).toEqual({ status: 'refused', reason: 'conflict' });
    expect(v.texts.get(file.path)).toBe(FM + BODY + 'someone else\n');
    expect(v.writes).toBe(0);
  });

  it('setBody writes when the body is still what the caller read', async () => {
    const { v, svc, file } = setup();
    const r = await svc.setBody(file, 'new body\n', { by: 'test', expectedBody: BODY });
    expect(r).toMatchObject({ status: 'written', before: BODY, after: 'new body\n' });
    expect(v.texts.get(file.path)).toBe(FM + 'new body\n');
  });

  it('reports nothing changed, and writes nothing, for an identical body', async () => {
    const { v, svc, file } = setup();
    expect(await svc.setBody(file, BODY, { by: 't', expectedBody: BODY })).toEqual({ status: 'unchanged' });
    expect(await svc.editBody(file, (b) => b, { by: 't' })).toEqual({ status: 'unchanged' });
    expect(await svc.editBody(file, () => null, { by: 't' })).toEqual({ status: 'unchanged' });
    expect(await svc.insertAtSection(file, 'Top', '', 'start', { by: 't' })).toEqual({ status: 'unchanged' });
    expect(v.writes).toBe(0);
    expect(v.texts.get(file.path)).toBe(FM + BODY);
  });

  it('passes a missing, an ambiguous and a code-fence heading problem on as a refusal', async () => {
    const { svc, file } = setup(FM + '# A\n## X\n## X\n```\nc\n');
    expect(await svc.insertAtSection(file, 'Nope', 'x', 'start', { by: 't' })).toEqual({ status: 'refused', reason: 'heading-not-found' });
    expect(await svc.insertAtSection(file, 'X', 'x', 'start', { by: 't' })).toEqual({ status: 'refused', reason: 'heading-ambiguous' });
    expect(await svc.insertAtSection(file, 'A', 'x', 'after', { by: 't' })).toEqual({ status: 'refused', reason: 'inside-code' });
  });

  it('uses the whole note line ending for new lines even when the body had no line break', async () => {
    const { v, svc, file } = setup('---\r\na: 1\r\n---\r\n# Only heading');
    await svc.insertAtSection(file, 'Only heading', 'x', 'start', { by: 't' });
    expect(v.texts.get(file.path)).toBe('---\r\na: 1\r\n---\r\n# Only heading\r\nx');
  });
});

describe('refusals', () => {
  const reasons: GateRefusal[] = ['rubric-off', 'body-edits-off', 'unmanaged', 'no-type', 'type-not-enabled', 'newer-schema'];
  it.each(reasons)('does not touch the note when the gate says %s', async (reason) => {
    const { v, svc, file } = setup();
    v.gate = () => ({ allowed: false, reason });
    expect(await svc.editBody(file, (b) => b + 'x', { by: 't' })).toEqual({ status: 'refused', reason });
    expect(await svc.setBody(file, 'x', { by: 't', expectedBody: BODY })).toEqual({ status: 'refused', reason });
    expect(await svc.insertAtSection(file, 'Top', 'x', 'start', { by: 't' })).toEqual({ status: 'refused', reason });
    expect(v.processCalls).toBe(0);
    expect(v.texts.get(file.path)).toBe(FM + BODY);
  });

  it('refuses a note that turns out to be on a newer schema at write time', async () => {
    const { v, svc, file } = setup();
    v.readOnly = true;
    expect(await svc.editBody(file, (b) => b + 'x', { by: 't' })).toEqual({ status: 'refused', reason: 'newer-schema' });
  });

  it('reports a failed write, or a throwing function, as an error and writes nothing', async () => {
    const { v, svc, file } = setup();
    v.failWith = 'disk full';
    expect(await svc.editBody(file, (b) => b + 'x', { by: 't' })).toEqual({ status: 'error', message: 'disk full' });
    v.failWith = null;
    const r = await svc.editBody(file, () => { throw new Error('boom'); }, { by: 't' });
    expect(r).toEqual({ status: 'error', message: 'boom' });
    expect(v.texts.get(file.path)).toBe(FM + BODY);
  });
});

describe('debug log', () => {
  it('says which caller changed which note, only when the debug setting is on', async () => {
    const { v, svc, file } = setup();
    await svc.insertAtSection(file, 'Top', 'one', 'start', { by: 'quiet' });
    expect(v.logs).toEqual([]);
    v.debug = true;
    await svc.insertAtSection(file, 'Top', 'two', 'start', { by: 'my-handler' });
    expect(v.logs).toEqual(['my-handler changed Tasks/a.md (+4 −0 characters)']);
    v.gate = () => ({ allowed: false, reason: 'body-edits-off' });
    await svc.editBody(file, (b) => b, { by: 'my-handler' });
    expect(v.logs[1]).toBe('my-handler was refused on Tasks/a.md: body-edits-off');
  });
});
