/**
 * Schema templates (`_schema/templates/<type>.md`): a starting body, and optional starting values, for a new note
 * of a type. The body is inserted only into an empty note; the values only where the note has none. Placeholders:
 * {{name}} {{id}} {{type}} {{date}} {{datetime}} {{folder}}.
 */
import { bodyOf, readFrontmatter } from './frontmatter';
import type { Frontmatter } from './frontmatter';
import type { PropertyDef, ResolvedType } from './schema-types';
import { formatLocal, formatLocalDate } from './timestamps';
import { validateValue } from './validate';

export const PLACEHOLDERS = ['name', 'id', 'type', 'date', 'datetime', 'folder'] as const;

/** Properties a template may not set: the plugin or another plugin owns them. */
export const TEMPLATE_RESERVED = new Set(['type', 'schema', 'id', 'created', 'modified', 'breadcrumb', 'archived_fields']);

export interface TemplateDef {
  type: string;
  file: string;
  /** Starting values, already checked against the type; reserved and invalid ones are dropped. */
  values: Record<string, unknown>;
  body: string;
}

export interface TemplateIssue {
  message: string;
  line?: number;
}

export interface RenderContext {
  name: string;
  id: string;
  type: string;
  now: Date;
  folder: string;
}

/** Placeholder names used in a text, in order of appearance. */
export function findPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1] as string);
}

/** Replace the known placeholders; an unknown one is left as written. */
export function renderText(text: string, ctx: RenderContext): string {
  const values: Record<string, string> = {
    name: ctx.name,
    id: ctx.id,
    type: ctx.type,
    date: formatLocalDate(ctx.now),
    datetime: formatLocal(ctx.now),
    folder: ctx.folder,
  };
  return text.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (whole, key: string) => (key in values ? (values[key] as string) : whole));
}

function renderValue(v: unknown, ctx: RenderContext): unknown {
  if (typeof v === 'string') return renderText(v, ctx);
  if (Array.isArray(v)) return v.map((x) => renderValue(x, ctx));
  return v;
}

/**
 * Read a template file for a type. Problems are warnings (a bad template never stops the schema loading):
 * the offending value or the whole template is skipped.
 */
export function parseTemplate(
  type: ResolvedType,
  file: string,
  text: string,
  lineOfKey: (key: string) => number | undefined = () => undefined,
): { def: TemplateDef | null; issues: TemplateIssue[] } {
  const issues: TemplateIssue[] = [];
  let fm: Frontmatter | undefined;
  try {
    fm = readFrontmatter(text);
  } catch (e) {
    return { def: null, issues: [{ message: `The template’s properties are not valid YAML (${e instanceof Error ? e.message : String(e)}); the template is not used.`, line: 2 }] };
  }
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm ?? {})) {
    const def: PropertyDef | undefined = type.byName.get(key);
    if (TEMPLATE_RESERVED.has(key)) {
      issues.push({ message: `Template property “${key}” is set by the plugin and is ignored.`, line: lineOfKey(key) });
      continue;
    }
    if (!def) {
      issues.push({ message: `Template property “${key}” is not in the ${type.name} schema and is ignored.`, line: lineOfKey(key) });
      continue;
    }
    // a placeholder is checked after it is filled in, so only plain values are checked here
    const holds = JSON.stringify(value).includes('{{');
    const bad = holds ? null : validateValue(def, value);
    if (bad) {
      issues.push({ message: `Template property “${key}”: ${bad.message}. It is ignored.`, line: lineOfKey(key) });
      continue;
    }
    values[key] = value;
  }
  const body = bodyOf(text);
  const known = new Set<string>(PLACEHOLDERS);
  for (const p of new Set([...findPlaceholders(body), ...findPlaceholders(JSON.stringify(values))])) {
    if (!known.has(p)) issues.push({ message: `Unknown placeholder {{${p}}} (use ${PLACEHOLDERS.map((x) => `{{${x}}}`).join(', ')}).` });
  }
  return { def: { type: type.name, file, values, body: fm ? body : text }, issues };
}

export interface TemplateUse {
  /** Values to start with. They never replace a value the note already has. */
  values: Record<string, unknown>;
  /** The body to insert, or null when there is none. */
  body: string | null;
}

/** The template filled in for one note. */
export function useTemplate(def: TemplateDef | undefined, type: ResolvedType, ctx: RenderContext): TemplateUse {
  if (!def) return { values: {}, body: null };
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def.values)) {
    const rendered = renderValue(v, ctx);
    const prop = type.byName.get(k);
    if (prop && validateValue(prop, rendered)) continue; // a placeholder that came out invalid: skip it
    values[k] = rendered;
  }
  const body = def.body.trim().length > 0 ? renderText(def.body, ctx) : null;
  return { values, body };
}

/** Insert the template body into an empty note only. A note with any text keeps it exactly. */
export function insertBodyIfEmpty(existing: string, body: string | null): string {
  if (body === null || existing.trim().length > 0) return existing;
  return body.endsWith('\n') ? body : body + '\n';
}
