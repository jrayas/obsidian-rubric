import { describe, expect, it } from 'vitest';
import { scaffoldBody } from '../src/core/body-scaffold';
import { emptyRules } from '../src/core/body-rules';
import type { BodyRules, BodySection } from '../src/core/body-rules';
import type { FormulaContext } from '../src/core/formula';

const cx: FormulaContext = {
  now: new Date(2026, 10, 3, 14, 9),
  file: { name: '2026-11-03.md', basename: '2026-11-03', path: 'Journal/2026-11-03.md', folder: 'Journal', ext: 'md' },
  props: { status: 'open' },
};
const section = (heading: string, extra: Partial<BodySection> = {}): BodySection => ({ heading, scaffold: true, keys: {}, ...extra });
const rules = (...sections: BodySection[]): BodyRules => ({ ...emptyRules(), sections });

describe('scaffoldBody', () => {
  it('writes each heading, a blank line, and the starter text with its placeholders worked out', () => {
    const r = scaffoldBody(rules(section('Captures', { starter: '- {{time:HH:mm}} ' }), section('Gratitude', { starter: '- ' })), cx);
    expect(r.text).toBe('## Captures\n\n- 14:09 \n\n## Gratitude\n\n- \n\n');
    expect(r.errors).toEqual([]);
  });

  it('uses the level of the section, and 2 when none is given', () => {
    expect(scaffoldBody(rules(section('A', { level: 1 }), section('B', { level: 3 }), section('C')), cx).text).toBe('# A\n\n### B\n\n## C\n\n');
  });

  it('skips a section with scaffold: false', () => {
    expect(scaffoldBody(rules(section('Keep'), section('Skip', { scaffold: false })), cx).text).toBe('## Keep\n\n');
  });

  it('keeps starter text of several lines, and formulas', () => {
    const r = scaffoldBody(rules(section('Day', { starter: '{{ file.basename }}\n- {{ status }}\n' })), cx);
    expect(r.text).toBe('## Day\n\n2026-11-03\n- open\n\n');
  });

  it('is empty when no section is meant for new notes', () => {
    expect(scaffoldBody(emptyRules(), cx).text).toBe('');
    expect(scaffoldBody(rules(section('A', { scaffold: false })), cx).text).toBe('');
  });

  it('reports a placeholder that fails and writes it as nothing', () => {
    const r = scaffoldBody(rules(section('A', { starter: 'x {{ "a" - 1 }}y' })), cx);
    expect(r.text).toBe('## A\n\nx y\n\n');
    expect(r.errors[0]).toMatch(/needs two numbers/);
  });
});
