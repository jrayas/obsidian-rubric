// A small formula language for note bodies, modelled on Obsidian Bases formulas: `now().format("HH:mm")`,
// `file.basename`, `if(mood >= 4, "good", "")`, string methods such as `.lower()` and `.replace()`.
//
// It is a subset, written here because Obsidian offers plugins no way to run Bases' own engine, and it never runs
// JavaScript (no `eval`). Pure: no Obsidian types; the clock and the note's facts come in through the context.
import { formatMoment } from './moment-format';

export class FormulaDate {
  constructor(readonly date: Date) {}
}

export type FValue = string | number | boolean | null | FormulaDate | FValue[] | { [key: string]: FValue };

export interface FormulaFile {
  name: string;
  basename: string;
  path: string;
  folder: string;
  ext: string;
  ctime?: Date | null;
  mtime?: Date | null;
}

export interface FormulaContext {
  now: Date;
  file: FormulaFile;
  /** The note's frontmatter. Read as `note.status`, or just `status`. */
  props: Record<string, unknown>;
}

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

export const MAX_FORMULA_LENGTH = 2000;
const MAX_DEPTH = 40;
const MAX_STRING = 10_000;

// ---------------------------------------------------------------------------------------------- syntax tree

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'lit'; v: boolean | null }
  | { t: 'id'; name: string; pos: number }
  | { t: 'member'; obj: Expr; name: string; pos: number }
  | { t: 'call'; callee: Expr; args: Expr[]; pos: number }
  | { t: 'unary'; op: '!' | '-'; arg: Expr; pos: number }
  | { t: 'bin'; op: BinOp; left: Expr; right: Expr; pos: number };

type BinOp = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';

// ---------------------------------------------------------------------------------------------- tokens

interface Token {
  type: 'num' | 'str' | 'id' | 'op' | 'eof';
  value: string;
  pos: number;
}

const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ',', '.'];

function tokenise(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/.exec(src.slice(i));
      const text = m?.[0] ?? ch;
      tokens.push({ type: 'num', value: text, pos: i });
      i += text.length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      const text = m?.[0] ?? ch;
      tokens.push({ type: 'id', value: text, pos: i });
      i += text.length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let out = '';
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        const c = src.charAt(j);
        if (c === '\\' && j + 1 < src.length) {
          const next = src.charAt(j + 1);
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          j += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          j++;
          break;
        }
        out += c;
        j++;
      }
      if (!closed) throw new FormulaError(`The text starting at position ${i + 1} is not closed with ${ch}`, i);
      tokens.push({ type: 'str', value: out, pos: i });
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`Unexpected character "${ch}" at position ${i + 1}`, i);
    tokens.push({ type: 'op', value: op, pos: i });
    i += op.length;
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

// ---------------------------------------------------------------------------------------------- parser

const PRECEDENCE: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private get tok(): Token {
    return this.tokens[this.i] ?? { type: 'eof', value: '', pos: 0 };
  }

  private is(value: string): boolean {
    return this.tok.type === 'op' && this.tok.value === value;
  }

  private expect(value: string): void {
    if (!this.is(value)) throw new FormulaError(`Expected "${value}" at position ${this.tok.pos + 1}`, this.tok.pos);
    this.i++;
  }

  parse(): Expr {
    const e = this.expression(0, 0);
    if (this.tok.type !== 'eof') throw new FormulaError(`Unexpected "${this.tok.value}" at position ${this.tok.pos + 1}`, this.tok.pos);
    return e;
  }

  private expression(minPrecedence: number, depth: number): Expr {
    if (depth > MAX_DEPTH) throw new FormulaError('The formula is nested too deeply', this.tok.pos);
    let left = this.unary(depth);
    for (;;) {
      const t = this.tok;
      const prec = t.type === 'op' ? PRECEDENCE[t.value] : undefined;
      if (prec === undefined || prec <= minPrecedence) return left;
      this.i++;
      const right = this.expression(prec, depth + 1);
      left = { t: 'bin', op: t.value as BinOp, left, right, pos: t.pos };
    }
  }

  private unary(depth: number): Expr {
    const t = this.tok;
    if (t.type === 'op' && (t.value === '!' || t.value === '-')) {
      this.i++;
      return { t: 'unary', op: t.value, arg: this.unary(depth + 1), pos: t.pos };
    }
    return this.postfix(this.primary(depth), depth);
  }

  private postfix(start: Expr, depth: number): Expr {
    let e = start;
    for (;;) {
      if (this.is('.')) {
        this.i++;
        const name = this.tok;
        if (name.type !== 'id') throw new FormulaError(`Expected a name after "." at position ${name.pos + 1}`, name.pos);
        this.i++;
        e = { t: 'member', obj: e, name: name.value, pos: name.pos };
      } else if (this.is('(')) {
        const open = this.tok.pos;
        this.i++;
        const args: Expr[] = [];
        if (!this.is(')')) {
          for (;;) {
            args.push(this.expression(0, depth + 1));
            if (this.is(',')) {
              this.i++;
              continue;
            }
            break;
          }
        }
        this.expect(')');
        e = { t: 'call', callee: e, args, pos: open };
      } else return e;
    }
  }

  private primary(depth: number): Expr {
    const t = this.tok;
    if (t.type === 'num') {
      this.i++;
      return { t: 'num', v: Number(t.value) };
    }
    if (t.type === 'str') {
      this.i++;
      return { t: 'str', v: t.value };
    }
    if (t.type === 'id') {
      this.i++;
      if (t.value === 'true') return { t: 'lit', v: true };
      if (t.value === 'false') return { t: 'lit', v: false };
      if (t.value === 'null') return { t: 'lit', v: null };
      return { t: 'id', name: t.value, pos: t.pos };
    }
    if (this.is('(')) {
      this.i++;
      const e = this.expression(0, depth + 1);
      this.expect(')');
      return e;
    }
    throw new FormulaError(t.type === 'eof' ? 'The formula ends too soon' : `Unexpected "${t.value}" at position ${t.pos + 1}`, t.pos);
  }
}

/** Parse a formula. Throws a FormulaError that says where it went wrong. */
export function parseFormula(source: string): Expr {
  if (source.trim() === '') throw new FormulaError('The formula is empty', 0);
  if (source.length > MAX_FORMULA_LENGTH) throw new FormulaError(`The formula is longer than ${MAX_FORMULA_LENGTH} characters`, 0);
  return new Parser(tokenise(source)).parse();
}

// ---------------------------------------------------------------------------------------------- values

const isDate = (v: FValue): v is FormulaDate => v instanceof FormulaDate;
const isList = (v: FValue): v is FValue[] => Array.isArray(v);
const isObject = (v: FValue): v is { [key: string]: FValue } => typeof v === 'object' && v !== null && !isDate(v) && !isList(v);

/** Turn a raw frontmatter value into a formula value. */
export function toValue(raw: unknown): FValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (raw instanceof Date) return new FormulaDate(raw);
  if (Array.isArray(raw)) return raw.map(toValue);
  if (typeof raw === 'object') {
    const out: { [key: string]: FValue } = {};
    for (const [k, v] of Object.entries(raw)) out[k] = toValue(v);
    return out;
  }
  return null;
}

const truthy = (v: FValue): boolean => !(v === null || v === false || v === 0 || v === '' || (typeof v === 'number' && Number.isNaN(v)));

/** How a value reads inside text: no value is nothing, a date has its date and, when it has one, its time. */
export function valueToText(v: FValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (isDate(v)) {
    const d = v.date;
    return d.getHours() + d.getMinutes() + d.getSeconds() === 0 ? formatMoment(d, 'YYYY-MM-DD') : formatMoment(d, 'YYYY-MM-DD HH:mm:ss');
  }
  if (isList(v)) return v.map(valueToText).join(', ');
  return '';
}

function describe(v: FValue): string {
  if (v === null) return 'nothing';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'boolean') return 'true or false';
  if (isDate(v)) return 'a date';
  if (isList(v)) return 'a list';
  return 'an object';
}

function fileObject(f: FormulaContext['file']): FValue {
  return {
    name: f.name,
    basename: f.basename,
    path: f.path,
    folder: f.folder,
    ext: f.ext,
    ctime: f.ctime ? new FormulaDate(f.ctime) : null,
    mtime: f.mtime ? new FormulaDate(f.mtime) : null,
  };
}

function parseDate(text: string): FormulaDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  return Number.isNaN(date.getTime()) ? null : new FormulaDate(date);
}

// ---------------------------------------------------------------------------------------------- evaluation

function need<T extends FValue>(args: FValue[], index: number, kind: 'string' | 'number', method: string): T {
  const v = args[index];
  if (typeof v !== kind) throw new FormulaError(`${method} needs ${kind === 'string' ? 'text' : 'a number'} as argument ${index + 1}`, 0);
  return v as T;
}

function capped(text: string): string {
  if (text.length > MAX_STRING) throw new FormulaError(`The result is longer than ${MAX_STRING} characters`, 0);
  return text;
}

function dateMethod(d: FormulaDate, name: string, args: FValue[]): FValue {
  switch (name) {
    case 'format':
      return formatMoment(d.date, args[0] === undefined ? 'YYYY-MM-DD HH:mm:ss' : need<string>(args, 0, 'string', 'format()'));
    case 'time':
      return formatMoment(d.date, 'HH:mm:ss');
    case 'date':
      return new FormulaDate(new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()));
    case 'isEmpty':
      return false;
    default:
      throw new FormulaError(`A date has no method "${name}"`, 0);
  }
}

function stringMethod(s: string, name: string, args: FValue[]): FValue {
  switch (name) {
    case 'contains':
      return s.includes(valueToText(args[0] ?? null));
    case 'containsAll':
      return args.every((a) => s.includes(valueToText(a)));
    case 'containsAny':
      return args.some((a) => s.includes(valueToText(a)));
    case 'startsWith':
      return s.startsWith(valueToText(args[0] ?? null));
    case 'endsWith':
      return s.endsWith(valueToText(args[0] ?? null));
    case 'isEmpty':
      return s === '';
    case 'lower':
      return s.toLowerCase();
    case 'title':
      return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    case 'trim':
      return s.trim();
    case 'replace':
      return s.replace(valueToText(args[0] ?? null), () => valueToText(args[1] ?? null));
    case 'repeat':
      return capped(s.repeat(Math.max(0, Math.min(1000, Math.floor(need<number>(args, 0, 'number', 'repeat()'))))));
    case 'reverse':
      return [...s].reverse().join('');
    case 'slice':
      return s.slice(need<number>(args, 0, 'number', 'slice()'), args[1] === undefined ? undefined : need<number>(args, 1, 'number', 'slice()'));
    case 'split':
      return s.split(valueToText(args[0] ?? null), args[1] === undefined ? undefined : need<number>(args, 1, 'number', 'split()'));
    default:
      throw new FormulaError(`Text has no method "${name}"`, 0);
  }
}

function listMethod(l: FValue[], name: string, args: FValue[]): FValue {
  switch (name) {
    case 'contains':
      return l.some((x) => valueToText(x) === valueToText(args[0] ?? null));
    case 'isEmpty':
      return l.length === 0;
    case 'join':
      return capped(l.map(valueToText).join(args[0] === undefined ? ',' : valueToText(args[0])));
    default:
      throw new FormulaError(`A list has no method "${name}"`, 0);
  }
}

function member(obj: FValue, name: string): FValue {
  if (isDate(obj)) {
    const d = obj.date;
    switch (name) {
      case 'year':
        return d.getFullYear();
      case 'month':
        return d.getMonth() + 1;
      case 'day':
        return d.getDate();
      case 'hour':
        return d.getHours();
      case 'minute':
        return d.getMinutes();
      case 'second':
        return d.getSeconds();
      case 'millisecond':
        return d.getMilliseconds();
      default:
        return null;
    }
  }
  if (typeof obj === 'string' && name === 'length') return obj.length;
  if (isList(obj) && name === 'length') return obj.length;
  if (isObject(obj)) return Object.prototype.hasOwnProperty.call(obj, name) ? (obj[name] ?? null) : null;
  return null;
}

function compare(a: FValue, b: FValue, pos: number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (isDate(a) && isDate(b)) return a.date.getTime() - b.date.getTime();
  throw new FormulaError(`Cannot compare ${describe(a)} with ${describe(b)}`, pos);
}

function equal(a: FValue, b: FValue): boolean {
  if (isDate(a) && isDate(b)) return a.date.getTime() === b.date.getTime();
  return a === b;
}

function numbers(args: FValue[], name: string): number[] {
  return args.map((a, i) => {
    if (typeof a !== 'number') throw new FormulaError(`${name}() needs numbers; argument ${i + 1} is ${describe(a)}`, 0);
    return a;
  });
}

function call(e: Extract<Expr, { t: 'call' }>, cx: FormulaContext): FValue {
  const callee = e.callee;
  if (callee.t === 'id') {
    // `if` is lazy: only the branch that is chosen is worked out.
    if (callee.name === 'if') {
      if (e.args.length < 2 || e.args.length > 3) throw new FormulaError('if() needs a condition, a result and, optionally, an else result', e.pos);
      const [cond, yes, no] = e.args as [Expr, Expr, Expr | undefined];
      return truthy(evaluate(cond, cx)) ? evaluate(yes, cx) : no ? evaluate(no, cx) : null;
    }
    const args = e.args.map((a) => evaluate(a, cx));
    switch (callee.name) {
      case 'now':
        return new FormulaDate(cx.now);
      case 'today':
        return new FormulaDate(new Date(cx.now.getFullYear(), cx.now.getMonth(), cx.now.getDate()));
      case 'date': {
        const v = args[0];
        if (typeof v === 'string') return parseDate(v);
        return isDate(v ?? null) ? (v as FormulaDate) : null;
      }
      case 'number': {
        const v = args[0] ?? null;
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
        if (typeof v === 'boolean') return v ? 1 : 0;
        return null;
      }
      case 'min':
        return Math.min(...numbers(args, 'min'));
      case 'max':
        return Math.max(...numbers(args, 'max'));
      default:
        throw new FormulaError(`Unknown function "${callee.name}"`, callee.pos);
    }
  }
  if (callee.t === 'member') {
    const target = evaluate(callee.obj, cx);
    const args = e.args.map((a) => evaluate(a, cx));
    try {
      if (isDate(target)) return dateMethod(target, callee.name, args);
      if (typeof target === 'string') return stringMethod(target, callee.name, args);
      if (isList(target)) return listMethod(target, callee.name, args);
    } catch (err) {
      if (err instanceof FormulaError && err.position === 0) throw new FormulaError(err.message, callee.pos);
      throw err;
    }
    throw new FormulaError(`There is no method "${callee.name}" for ${describe(target)}`, callee.pos);
  }
  throw new FormulaError('Only a function or a method can be called', e.pos);
}

export function evaluate(e: Expr, cx: FormulaContext): FValue {
  switch (e.t) {
    case 'num':
    case 'str':
    case 'lit':
      return e.v;
    case 'id':
      if (e.name === 'file') return fileObject(cx.file);
      if (e.name === 'note') return toValue(cx.props);
      return Object.prototype.hasOwnProperty.call(cx.props, e.name) ? toValue(cx.props[e.name]) : null;
    case 'member':
      return member(evaluate(e.obj, cx), e.name);
    case 'call':
      return call(e, cx);
    case 'unary': {
      const v = evaluate(e.arg, cx);
      if (e.op === '!') return !truthy(v);
      if (typeof v !== 'number') throw new FormulaError(`Cannot negate ${describe(v)}`, e.pos);
      return -v;
    }
    case 'bin': {
      if (e.op === '&&') {
        const l = evaluate(e.left, cx);
        return truthy(l) ? evaluate(e.right, cx) : l;
      }
      if (e.op === '||') {
        const l = evaluate(e.left, cx);
        return truthy(l) ? l : evaluate(e.right, cx);
      }
      const l = evaluate(e.left, cx);
      const r = evaluate(e.right, cx);
      switch (e.op) {
        case '+':
          if (typeof l === 'number' && typeof r === 'number') return l + r;
          if (typeof l === 'string' || typeof r === 'string') return capped(valueToText(l) + valueToText(r));
          throw new FormulaError(`Cannot add ${describe(l)} and ${describe(r)}`, e.pos);
        case '-':
        case '*':
        case '/':
        case '%': {
          if (typeof l !== 'number' || typeof r !== 'number') throw new FormulaError(`"${e.op}" needs two numbers, not ${describe(l)} and ${describe(r)}`, e.pos);
          if (e.op === '-') return l - r;
          if (e.op === '*') return l * r;
          if (r === 0) return null;
          return e.op === '/' ? l / r : l % r;
        }
        case '==':
          return equal(l, r);
        case '!=':
          return !equal(l, r);
        case '<':
          return compare(l, r, e.pos) < 0;
        case '<=':
          return compare(l, r, e.pos) <= 0;
        case '>':
          return compare(l, r, e.pos) > 0;
        case '>=':
          return compare(l, r, e.pos) >= 0;
        default:
          return null;
      }
    }
  }
}

/** Parse and evaluate in one step. */
export function runFormula(source: string, cx: FormulaContext): FValue {
  return evaluate(parseFormula(source), cx);
}
