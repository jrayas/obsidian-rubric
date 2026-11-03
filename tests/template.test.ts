import { describe, expect, it } from 'vitest';
import type { FormulaContext } from '../src/core/formula';
import { parseTemplate, renderTemplate, templateRegexSource, validateTemplate } from '../src/core/template';

// Tuesday 3 November 2026, 14:09 local time.
const cx = (props: Record<string, unknown> = {}): FormulaContext => ({
  now: new Date(2026, 10, 3, 14, 9, 30),
  file: { name: '2026-11-03.md', basename: '2026-11-03', path: 'Journal/2026-11-03.md', folder: 'Journal', ext: 'md' },
  props,
});
const render = (t: string, props: Record<string, unknown> = {}) => renderTemplate(t, cx(props));

describe('template variables from Obsidian core Templates', () => {
  it('writes the time, the date and the title, with default and custom formats', () => {
    expect(render('- {{time}} ').text).toBe('- 14:09 ');
    expect(render('- {{time:HH:mm}} ').text).toBe('- 14:09 ');
    expect(render('{{date}}').text).toBe('2026-11-03');
    expect(render('{{date:dddd D MMMM}}').text).toBe('Tuesday 3 November');
    expect(render('# {{title}}').text).toBe('# 2026-11-03');
    expect(render('{{time:h:mm A}}').text).toBe('2:09 PM');
  });

  it('allows spaces inside the braces', () => {
    expect(render('{{ time:HH:mm }}').text).toBe('14:09');
  });
});

describe('formulas', () => {
  it('works out a Bases-style formula', () => {
    expect(render("- {{ now().format('ddd HH:mm') }} ").text).toBe('- Tue 14:09 ');
    expect(render('{{ file.basename }}').text).toBe('2026-11-03');
    expect(render("{{ if(mood >= 4, 'good', 'ok') }}", { mood: 5 }).text).toBe('good');
  });

  it('mixes text, variables and formulas in one line', () => {
    expect(render("{{time}} {{ status.upper }} {{ 'x' + 'y' }}", { status: 'open' }).text).toBe('14:09  xy');
  });

  it('writes a formula that fails as nothing, and says why', () => {
    const r = render('a {{ "x" - 1 }} b');
    expect(r.text).toBe('a  b');
    expect(r.errors[0]).toMatch(/needs two numbers/);
  });
});

describe('mistakes are found before the template is used', () => {
  it('reports a placeholder that is not closed', () => {
    expect(validateTemplate('- {{time')[0]).toMatch(/no closing/);
  });

  it('reports an empty placeholder and a formula that does not parse, naming it', () => {
    expect(validateTemplate('{{ }}')[0]).toMatch(/empty/);
    const [msg] = validateTemplate('- {{ now( }}');
    expect(msg).toContain('now(');
    expect(msg).toMatch(/Expected|ends too soon/);
  });

  it('finds nothing wrong in a good template', () => {
    expect(validateTemplate("- {{time:HH:mm}} {{ now().format('ddd') }}")).toEqual([]);
    expect(validateTemplate('plain text, a lone { brace and } too')).toEqual([]);
  });

  it('keeps the text around a broken placeholder', () => {
    expect(parseTemplate('a {{ 1 + }} b').segments.filter((s) => s.kind === 'text').map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['a ', ' b']);
  });
});

describe('templateRegexSource: recognising a line the template wrote', () => {
  const matches = (template: string, line: string) => new RegExp(`^${templateRegexSource(template)}$`).test(line);

  it('matches the generated text for dates and times, and not typed text', () => {
    expect(matches('- {{time:HH:mm}}', '- 10:03')).toBe(true);
    expect(matches('- {{time:HH:mm}}', '- went walking')).toBe(false);
    expect(matches('{{date}} {{time}}', '2026-11-03 14:09')).toBe(true);
  });

  it('follows the format of a formula that ends in .format()', () => {
    expect(matches("- {{ now().format('ddd HH:mm') }}", '- Tue 14:09')).toBe(true);
    expect(matches("- {{ now().format('ddd HH:mm') }}", '- Tue went')).toBe(false);
  });

  it('matches one word for any other formula', () => {
    expect(matches('- {{ status }}', '- open')).toBe(true);
    expect(matches('- {{ status }}', '- two words')).toBe(false);
  });

  it('escapes the template text', () => {
    expect(matches('* **{{time:HH:mm}}** (x)', '* **10:03** (x)')).toBe(true);
  });
});
