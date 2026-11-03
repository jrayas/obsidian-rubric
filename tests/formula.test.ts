import { describe, expect, it } from 'vitest';
import { FormulaDate, FormulaError, parseFormula, runFormula, valueToText } from '../src/core/formula';
import type { FormulaContext, FValue } from '../src/core/formula';

// Tuesday 3 November 2026, 14:09 local time.
const NOW = new Date(2026, 10, 3, 14, 9, 30);

const cx = (props: Record<string, unknown> = {}): FormulaContext => ({
  now: NOW,
  file: { name: '2026-11-03.md', basename: '2026-11-03', path: 'Journal/2026-11-03.md', folder: 'Journal', ext: 'md', ctime: new Date(2026, 10, 1, 8, 0), mtime: null },
  props,
});

const run = (src: string, props: Record<string, unknown> = {}): FValue => runFormula(src, cx(props));
const text = (src: string, props: Record<string, unknown> = {}): string => valueToText(run(src, props));

describe('dates', () => {
  it('formats now with Moment tokens, as Bases does', () => {
    expect(run('now().format("HH:mm")')).toBe('14:09');
    expect(run("now().format('YYYY-MM-DD')")).toBe('2026-11-03');
    expect(run('now().format("dddd D MMMM")')).toBe('Tuesday 3 November');
  });

  it('has today at midnight, the time as text, and the date part', () => {
    expect(run('today().format("HH:mm")')).toBe('00:00');
    expect(run('now().time()')).toBe('14:09:30');
    expect(text('now().date()')).toBe('2026-11-03');
  });

  it('reads the parts of a date', () => {
    expect(run('now().year')).toBe(2026);
    expect(run('now().month')).toBe(11);
    expect(run('now().day')).toBe(3);
    expect(run('now().hour')).toBe(14);
    expect(run('now().minute')).toBe(9);
  });

  it('parses a date from text, and gives nothing for text that is not a date', () => {
    expect(run('date("2025-05-27 09:30:00").format("HH:mm")')).toBe('09:30');
    expect(run('date("2025-05-27").format("D/M/YYYY")')).toBe('27/5/2025');
    expect(run('date("tomorrow")')).toBeNull();
  });

  it('compares dates', () => {
    expect(run('date("2020-01-01") < now()')).toBe(true);
    expect(run('now() == now()')).toBe(true);
  });
});

describe('the file and the note', () => {
  it('reads the file facts', () => {
    expect(run('file.basename')).toBe('2026-11-03');
    expect(run('file.folder')).toBe('Journal');
    expect(run('file.ext')).toBe('md');
    expect(run('file.ctime.format("D MMM")')).toBe('1 Nov');
    expect(run('file.mtime')).toBeNull();
  });

  it('reads note properties as note.x or just x, and gives nothing for a missing one', () => {
    const props = { status: 'open', mood: 4, tags: ['a', 'b'] };
    expect(run('note.status', props)).toBe('open');
    expect(run('status', props)).toBe('open');
    expect(run('mood + 1', props)).toBe(5);
    expect(run('missing', props)).toBeNull();
    expect(run('note.missing.length', props)).toBeNull();
  });

  it('reads lists', () => {
    const props = { tags: ['a', 'b'] };
    expect(run('tags.length', props)).toBe(2);
    expect(run('tags.contains("b")', props)).toBe(true);
    expect(run('tags.join(" / ")', props)).toBe('a / b');
    expect(run('tags.isEmpty()', props)).toBe(false);
  });
});

describe('text', () => {
  it('has the Bases string methods', () => {
    expect(run('"Hello".lower()')).toBe('hello');
    expect(run('"hello world".title()')).toBe('Hello World');
    expect(run('" hi ".trim()')).toBe('hi');
    expect(run('"a:b:c".replace(":", "-")')).toBe('a-b:c');
    expect(run('"123".repeat(2)')).toBe('123123');
    expect(run('"hello".reverse()')).toBe('olleh');
    expect(run('"hello".slice(1, 4)')).toBe('ell');
    expect(run('"a,b,c".split(",", 2)')).toEqual(['a', 'b']);
    expect(run('"hello".length')).toBe(5);
    expect(run('"hello".contains("ell")')).toBe(true);
    expect(run('"hello".containsAll("h", "e")')).toBe(true);
    expect(run('"hello".containsAny("x", "e")')).toBe(true);
    expect(run('"hello".startsWith("he")')).toBe(true);
    expect(run('"hello".endsWith("lo")')).toBe(true);
    expect(run('"".isEmpty()')).toBe(true);
  });

  it('joins text and values with +, and writes a missing value as nothing', () => {
    expect(text('"- " + now().format("HH:mm") + " "')).toBe('- 14:09 ');
    expect(text('"mood " + mood', { mood: 3 })).toBe('mood 3');
    expect(text('"x" + missing')).toBe('x');
  });

  it('understands both quote styles and escapes', () => {
    expect(run(`'it\\'s'`)).toBe("it's");
    expect(run('"a\\nb"')).toBe('a\nb');
  });
});

describe('logic and numbers', () => {
  it('chooses with if(), working out only the branch it takes', () => {
    expect(run('if(mood >= 4, "good", "fine")', { mood: 5 })).toBe('good');
    expect(run('if(mood >= 4, "good", "fine")', { mood: 2 })).toBe('fine');
    expect(run('if(false, 1 / 0 + "x", "safe")')).toBe('safe');
    expect(run('if(false, "a")')).toBeNull();
  });

  it('does arithmetic with the usual precedence', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('10 % 4')).toBe(2);
    expect(run('-3 + 5')).toBe(2);
    expect(run('1 / 0')).toBeNull();
  });

  it('has number(), min() and max()', () => {
    expect(run('number("3.4")')).toBe(3.4);
    expect(run('number("x")')).toBeNull();
    expect(run('max(3, 7)')).toBe(7);
    expect(run('min(3, 7, 1)')).toBe(1);
  });

  it('has && || ! and equality, with short-circuit', () => {
    expect(run('true && false')).toBe(false);
    expect(run('false || "x"')).toBe('x');
    expect(run('!false')).toBe(true);
    expect(run('1 == 1 && 2 != 3')).toBe(true);
    expect(run('"a" == "a"')).toBe(true);
    expect(run('mood > 2 && "good"', { mood: 3 })).toBe('good');
  });
});

describe('mistakes are reported, never run as code', () => {
  const message = (src: string, props: Record<string, unknown> = {}): string => {
    try {
      runFormula(src, cx(props));
    } catch (e) {
      if (e instanceof FormulaError) return e.message;
      throw e;
    }
    return '';
  };

  it('names the problem and the place', () => {
    expect(message('now(')).toMatch(/Expected "\)"|ends too soon/);
    expect(message('1 +')).toMatch(/ends too soon/);
    expect(message('"abc')).toMatch(/not closed/);
    expect(message('1 # 2')).toMatch(/Unexpected character "#" at position 3/);
    expect(message('')).toMatch(/empty/);
    expect(message('nope()')).toMatch(/Unknown function "nope"/);
    expect(message('"a".nope()')).toMatch(/no method "nope"/);
    expect(message('"a" - 1')).toMatch(/needs two numbers/);
    expect(message('"a" < 1')).toMatch(/Cannot compare/);
  });

  it('cannot reach JavaScript', () => {
    expect(message('constructor')).toBe('');
    expect(run('constructor')).toBeNull();
    expect(run('file.constructor')).toBeNull();
    expect(run('note.__proto__')).toBeNull();
    expect(run('toString')).toBeNull();
    expect(message('"a".constructor()')).toMatch(/no method/);
    expect(message('process.exit()')).toMatch(/no method|Only a function/);
    expect(message('this')).toBe('');
  });

  it('limits size', () => {
    expect(() => parseFormula('1' + ' + 1'.repeat(1000))).toThrow(FormulaError);
    expect(() => parseFormula('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/nested too deeply/);
    expect(message('"abcdefghij".repeat(1000).repeat(1000)')).toMatch(/longer than/);
  });
});

describe('valueToText', () => {
  it('writes values the way they read in a note', () => {
    expect(valueToText(null)).toBe('');
    expect(valueToText(true)).toBe('true');
    expect(valueToText(3)).toBe('3');
    expect(valueToText(0.1 + 0.2)).toBe('0.3');
    expect(valueToText(['a', 'b'])).toBe('a, b');
    expect(valueToText(new FormulaDate(new Date(2026, 0, 2)))).toBe('2026-01-02');
    expect(valueToText(new FormulaDate(new Date(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02 03:04:05');
  });
});
