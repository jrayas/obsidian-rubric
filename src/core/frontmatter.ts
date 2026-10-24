import { Document, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { YAMLMap, YAMLSeq } from 'yaml';
import type { ResolvedType } from './schema-types';
import { ARCHIVED_FIELDS } from './schema-types';

export type Frontmatter = Record<string, unknown>;

export class FrontmatterError extends Error {}

export type Eol = '\n' | '\r\n';

export interface KeyChange {
  key: string;
  before: unknown;
  after: unknown;
}

export interface EditResult {
  text: string;
  changed: boolean;
  changes: KeyChange[];
}

export interface EditOptions {
  /** Called with the final key list; returns the order to write. Applied only when something changed. */
  order?: (keys: string[]) => string[];
  /** Apply `order` even when no value changed. */
  forceOrder?: boolean;
}

/** The first line ending found in a file; LF when there is none. */
export function detectEol(text: string): Eol {
  const i = text.indexOf('\n');
  return i > 0 && text.charAt(i - 1) === '\r' ? '\r\n' : '\n';
}

interface Split {
  /** Everything before the YAML text, including the opening delimiter line. */
  head: string;
  yaml: string;
  /** The closing delimiter line and everything after it. */
  tail: string;
}

/** Split a file into opening delimiter, YAML text and the rest. Null when there is no frontmatter. */
function split(text: string): Split | null {
  const body = text.charAt(0) === '\ufeff' ? text.slice(1) : text;
  const bom = body.length === text.length ? '' : '\ufeff';
  const firstEnd = body.indexOf('\n');
  const first = firstEnd < 0 ? body : body.slice(0, firstEnd);
  if (!/^---[ \t]*\r?$/.test(first) || firstEnd < 0) return null;
  const contentStart = firstEnd + 1;
  let pos = contentStart;
  while (pos <= body.length) {
    const next = body.indexOf('\n', pos);
    const lineEnd = next < 0 ? body.length : next;
    const line = body.slice(pos, lineEnd);
    if (/^(---|\.\.\.)[ \t]*\r?$/.test(line)) {
      return { head: bom + body.slice(0, contentStart), yaml: body.slice(contentStart, pos), tail: body.slice(pos) };
    }
    if (next < 0) break;
    pos = next + 1;
  }
  return null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** Parsed frontmatter of a file, or undefined when it has none. Throws FrontmatterError on bad YAML. */
export function readFrontmatter(text: string): Frontmatter | undefined {
  const s = split(text);
  if (!s) return undefined;
  const doc = parseDocument(s.yaml);
  if (doc.errors.length > 0) throw new FrontmatterError(doc.errors[0]?.message ?? 'Invalid frontmatter');
  const v: unknown = doc.toJS();
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Frontmatter) : {};
}

/** Key text of a pair. New pairs hold a plain string key; parsed ones hold a scalar node. */
function keyOf(pair: { key: unknown }): string {
  const k = pair.key;
  if (typeof k === 'string') return k;
  if (isScalar(k)) return typeof k.value === 'string' ? k.value : JSON.stringify(k.value);
  return '';
}

/**
 * Change a note's frontmatter with a mutator that edits a plain copy of it.
 * Only keys whose value really differs are touched, the rest of the file (body, comments, the style of
 * untouched values, line endings) is kept byte for byte. Returns the same text when nothing changed.
 */
export function editFrontmatter(text: string, mutate: (fm: Frontmatter) => void, options: EditOptions = {}): EditResult {
  const eol = detectEol(text);
  const parts = split(text);
  const doc = parts ? parseDocument(parts.yaml) : new Document({});
  if (doc.errors.length > 0) throw new FrontmatterError(doc.errors[0]?.message ?? 'Invalid frontmatter');
  const currentRaw: unknown = doc.toJS();
  if (currentRaw !== null && currentRaw !== undefined && (typeof currentRaw !== 'object' || Array.isArray(currentRaw))) {
    throw new FrontmatterError('The frontmatter is not a map of properties');
  }
  const current: Frontmatter = (currentRaw as Frontmatter | null) ?? {};
  const draft = clone(current);
  mutate(draft);
  for (const key of Object.keys(draft)) if (draft[key] === undefined) delete draft[key];

  const changes: KeyChange[] = [];
  for (const key of Object.keys(draft)) {
    if (!(key in current) || !deepEqual(current[key], draft[key])) {
      changes.push({ key, before: current[key], after: draft[key] });
    }
  }
  for (const key of Object.keys(current)) {
    if (!(key in draft)) changes.push({ key, before: current[key], after: undefined });
  }

  const finalKeys = Object.keys(draft);
  const wantedOrder = options.order ? options.order(finalKeys) : finalKeys;
  const currentOrder = [...Object.keys(current).filter((k) => k in draft), ...finalKeys.filter((k) => !(k in current))];
  const orderDiffers = !deepEqual(wantedOrder, currentOrder);
  const applyOrder = options.order !== undefined && orderDiffers && (changes.length > 0 || options.forceOrder === true);

  if (changes.length === 0 && !applyOrder) return { text, changed: false, changes };

  if (!isMap(doc.contents)) doc.contents = doc.createNode({});
  const map = doc.contents as YAMLMap;
  for (const change of changes) {
    if (change.after === undefined) {
      map.delete(change.key);
      continue;
    }
    const node = doc.createNode(change.after);
    const old = map.get(change.key, true);
    if (isSeq(node) && isSeq(old) && old.flow) (node as YAMLSeq).flow = true;
    // Keep the user's trailing comment on a value we replace.
    if (old && typeof old === 'object' && 'comment' in old && typeof old.comment === 'string') {
      (node as { comment?: string }).comment = old.comment;
    }
    map.set(change.key, node);
  }
  if (applyOrder) {
    const byKey = new Map(map.items.map((p) => [keyOf(p), p]));
    map.items = wantedOrder.flatMap((k) => {
      const p = byKey.get(k);
      return p ? [p] : [];
    });
  }

  let yamlText = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  if (map.items.length === 0) yamlText = '';
  if (yamlText.length > 0 && !yamlText.endsWith('\n')) yamlText += '\n';
  if (eol === '\r\n') yamlText = yamlText.replace(/\r?\n/g, '\r\n');

  const out = parts
    ? parts.head + yamlText + parts.tail
    : `---${eol}${yamlText}---${eol}${text}`;
  return { text: out, changed: out !== text, changes };
}

/**
 * The order a note's properties should have: the type's fields in schema order, then any properties the
 * schema does not know (kept, never deleted), then `archived_fields`, then the `position: end` fields.
 */
export function desiredOrder(keys: string[], type: ResolvedType): string[] {
  const present = new Set(keys);
  const end = type.properties.filter((p) => p.position === 'end').map((p) => p.name);
  const known = type.properties.filter((p) => p.position !== 'end').map((p) => p.name);
  const knownSet = new Set([...known, ...end, ARCHIVED_FIELDS]);
  const out = [
    ...known.filter((k) => present.has(k)),
    ...keys.filter((k) => !knownSet.has(k)),
    ...(present.has(ARCHIVED_FIELDS) ? [ARCHIVED_FIELDS] : []),
    ...end.filter((k) => present.has(k)),
  ];
  return out;
}
