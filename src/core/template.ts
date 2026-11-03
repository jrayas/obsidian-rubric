// Text with `{{ ... }}` placeholders, as written in a body module: `- {{time:HH:mm}} ` or
// `- {{ now().format('ddd HH:mm') }} `. A placeholder is one of two things:
//   - a template variable from Obsidian's core Templates plugin: {{title}}, {{date}}, {{date:FORMAT}}, {{time}}, {{time:FORMAT}}
//   - a formula (see formula.ts), for anything else
// Pure: no Obsidian types.
import { evaluate, FormulaError, parseFormula, valueToText } from './formula';
import type { Expr, FormulaContext } from './formula';
import { formatMoment, formatToRegex } from './moment-format';

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_TIME_FORMAT = 'HH:mm';

export type Shorthand = { name: 'title' | 'date' | 'time'; format: string | null };

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'expr'; source: string; shorthand: Shorthand | null; expr: Expr | null };

export interface ParsedTemplate {
  segments: Segment[];
  /** Plain-English problems, each naming the placeholder. Empty when the template is sound. */
  errors: string[];
}

const SHORTHAND = /^(title|date|time)(?::([\s\S]*))?$/;

export function parseTemplate(text: string): ParsedTemplate {
  const segments: Segment[] = [];
  const errors: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open < 0) {
      segments.push({ kind: 'text', text: text.slice(i) });
      break;
    }
    if (open > i) segments.push({ kind: 'text', text: text.slice(i, open) });
    const close = text.indexOf('}}', open + 2);
    if (close < 0) {
      errors.push(`"{{" at position ${open + 1} has no closing "}}"`);
      segments.push({ kind: 'text', text: text.slice(open) });
      break;
    }
    const source = text.slice(open + 2, close).trim();
    i = close + 2;
    if (source === '') {
      errors.push('A "{{ }}" placeholder is empty');
      continue;
    }
    const short = SHORTHAND.exec(source);
    if (short) {
      segments.push({ kind: 'expr', source, shorthand: { name: short[1] as Shorthand['name'], format: short[2] === undefined || short[2] === '' ? null : short[2] }, expr: null });
      continue;
    }
    try {
      segments.push({ kind: 'expr', source, shorthand: null, expr: parseFormula(source) });
    } catch (e) {
      errors.push(`{{ ${source} }}: ${e instanceof FormulaError ? e.message : String(e)}`);
      segments.push({ kind: 'expr', source, shorthand: null, expr: null });
    }
  }
  return { segments, errors };
}

/** Problems with a template, for the schema loader. */
export function validateTemplate(text: string): string[] {
  return parseTemplate(text).errors;
}

export interface Rendered {
  text: string;
  /** Placeholders that could not be worked out; each is written as nothing. */
  errors: string[];
}

/** Work out every placeholder. One that fails is written as nothing and reported, so typing is never interrupted. */
export function renderTemplate(template: string | ParsedTemplate, cx: FormulaContext): Rendered {
  const parsed = typeof template === 'string' ? parseTemplate(template) : template;
  const errors: string[] = [];
  let out = '';
  for (const seg of parsed.segments) {
    if (seg.kind === 'text') {
      out += seg.text;
      continue;
    }
    if (seg.shorthand) {
      const { name, format } = seg.shorthand;
      if (name === 'title') out += cx.file.basename;
      else out += formatMoment(cx.now, format ?? (name === 'date' ? DEFAULT_DATE_FORMAT : DEFAULT_TIME_FORMAT));
      continue;
    }
    if (!seg.expr) continue; // a formula that did not parse: already in parsed.errors
    try {
      out += valueToText(evaluate(seg.expr, cx));
    } catch (e) {
      errors.push(`{{ ${seg.source} }}: ${e instanceof FormulaError ? e.message : String(e)}`);
    }
  }
  return { text: out, errors: [...parsed.errors, ...errors] };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FORMAT_CALL = /\.format\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\)\s*$/;

/**
 * A regular expression source for a line made from this template, used to tell an "empty" entry (only what the
 * template wrote) from one with text typed after it. A date or time matches its format; a formula that ends in
 * `.format("...")` matches that format; any other formula matches one word.
 */
export function templateRegexSource(template: string | ParsedTemplate): string {
  const parsed = typeof template === 'string' ? parseTemplate(template) : template;
  return parsed.segments
    .map((seg) => {
      if (seg.kind === 'text') return escapeRegExp(seg.text);
      if (seg.shorthand) {
        const { name, format } = seg.shorthand;
        if (name === 'title') return '.+?';
        return formatToRegex(format ?? (name === 'date' ? DEFAULT_DATE_FORMAT : DEFAULT_TIME_FORMAT));
      }
      const call = FORMAT_CALL.exec(seg.source);
      return call?.[2] !== undefined ? formatToRegex(call[2]) : '\\S+';
    })
    .join('');
}
