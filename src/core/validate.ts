import type { ItemType, PropertyDef } from './schema-types';

export interface ValueIssue {
  code: 'type' | 'enum' | 'min' | 'max' | 'pattern' | 'format' | 'link' | 'heading';
  message: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const isDateText = (v: unknown): v is string => {
  const m = typeof v === 'string' ? DATE.exec(v) : null;
  return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

export const isDatetimeText = (v: unknown): v is string => {
  const m = typeof v === 'string' ? DATETIME.exec(v) : null;
  return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3])) && Number(m[4]) < 24 && Number(m[5]) < 60;
};

const show = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? 'nothing'));

function validUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return ['http:', 'https:', 'ftp:', 'mailto:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/** `"[[Note]]"` or `"[[Note#Heading]]"` (an alias after | is allowed). */
const LINK = /^\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]*)?\]\]$/;

function checkScalar(def: PropertyDef, type: PropertyDef['type'] | ItemType, value: unknown): ValueIssue | null {
  switch (type) {
    case 'string':
    case 'term': {
      if (typeof value !== 'string') return { code: 'type', message: `"${def.name}" must be text (found ${show(value)})` };
      if (def.pattern && !new RegExp(def.pattern).test(value)) return { code: 'pattern', message: `"${value}" does not match the pattern for "${def.name}"` };
      return null;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return { code: 'type', message: `"${def.name}" must be a whole number (found ${show(value)})` };
      if (def.min !== undefined && value < def.min) return { code: 'min', message: `${value} is below the minimum ${def.min} for "${def.name}"` };
      if (def.max !== undefined && value > def.max) return { code: 'max', message: `${value} is above the maximum ${def.max} for "${def.name}"` };
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : { code: 'type', message: `"${def.name}" must be true or false (found ${show(value)})` };
    case 'date':
      return isDateText(value) ? null : { code: 'format', message: `"${def.name}" must be a date YYYY-MM-DD (found ${show(value)})` };
    case 'datetime':
      return isDatetimeText(value) ? null : { code: 'format', message: `"${def.name}" must be YYYY-MM-DDTHH:mm in local time (found ${show(value)})` };
    case 'url':
      return typeof value === 'string' && validUrl(value) ? null : { code: 'format', message: `"${def.name}" must be a web address (found ${show(value)})` };
    case 'link': {
      const m = typeof value === 'string' ? LINK.exec(value) : null;
      if (!m) return { code: 'link', message: `"${def.name}" must be a quoted wiki-link like "[[Note]]" (found ${show(value)})` };
      if (m[2] && !def.allowHeading) return { code: 'heading', message: `"${def.name}" may not link to a heading (found ${show(value)})` };
      return null;
    }
    case 'enum': {
      const values = def.values ?? [];
      return typeof value === 'string' && values.includes(value)
        ? null
        : { code: 'enum', message: `"${show(value)}" is not allowed for "${def.name}" (allowed: ${values.join(', ')})` };
    }
    default:
      return null;
  }
}

/** Check one present value against its definition. Returns the first problem, or null. */
export function validateValue(def: PropertyDef, value: unknown): ValueIssue | null {
  if (def.type === 'list') {
    if (!Array.isArray(value)) return { code: 'type', message: `"${def.name}" must be a list (found ${show(value)})` };
    for (const item of value) {
      const issue = checkScalar(def, def.items ?? 'string', item);
      if (issue) return issue;
    }
    return null;
  }
  return checkScalar(def, def.type, value);
}

/** Is the value empty (missing, null, empty text or an empty list)? */
export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}
