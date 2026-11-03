/**
 * The `body:` key of a type file and the rules a type gets from the `body` module. Pure.
 *
 * A type is opted in to body behaviour by using the `body` module (`uses: [base, body]`) or by having its own
 * `body:` block with sections or default rules. `body: { enabled: false }` turns it off again. Every body edit is
 * still behind the setting "Allow Rubric to edit note bodies".
 */
import { isObj, show } from './loader-base';
import type { Loader, Obj } from './loader-base';
import { emptyRules, hasRules, mergeBodyRules, parseBodyRules } from './body-rules';
import type { BodyRules } from './body-rules';
import type { YamlFile } from './yaml-file';

export interface BodyConfig {
  /** Handlers may act on notes of this type. */
  enabled: boolean;
  /** The merged rules of the modules the type uses and its own `body:` block. Absent when there are none. */
  rules?: BodyRules;
}

export const NO_BODY: BodyConfig = { enabled: false };

/** What the type file itself says under `body:`. */
export interface TypeBody {
  enabled: boolean | undefined;
  rules: BodyRules;
}

/** Keys under `body:` that mean something. Others are reported as warnings so new keys can be added later without breaking a pack. */
export const BODY_KEYS = new Set(['enabled', 'sections', 'default']);

export function parseBody(ld: Loader, yf: YamlFile, data: Obj): TypeBody {
  const none: TypeBody = { enabled: undefined, rules: emptyRules() };
  const raw = data.body;
  if (raw === undefined || raw === null) return none;
  if (!isObj(raw)) {
    ld.error('body-shape', yf.path, `"body" must be a map such as { enabled: true } (found ${show(raw)})`, yf.lineOf(['body']));
    return none;
  }
  for (const key of Object.keys(raw)) {
    if (!BODY_KEYS.has(key)) {
      ld.warn('body-unknown-key', yf.path, `Unknown key "${key}" under "body" (it has no effect; known keys: ${[...BODY_KEYS].join(', ')})`, yf.lineOf(['body', key]));
    }
  }
  let enabled: boolean | undefined;
  if (raw.enabled !== undefined && raw.enabled !== null) {
    if (typeof raw.enabled !== 'boolean') {
      ld.error('body-shape', yf.path, `"body.enabled" must be true or false (found ${show(raw.enabled)})`, yf.lineOf(['body', 'enabled']));
    } else enabled = raw.enabled;
  }
  return { enabled, rules: parseBodyRules(ld, yf, raw, ['body']) };
}

/** Put the rules of the modules (in `uses` order) and the type's own block together. */
export function resolveBody(fromModules: (BodyRules | undefined)[], own: TypeBody): BodyConfig {
  let rules = emptyRules();
  for (const m of fromModules) if (m) rules = mergeBodyRules(rules, m);
  rules = mergeBodyRules(rules, own.rules);
  const present = hasRules(rules);
  const enabled = own.enabled ?? present;
  return present ? { enabled, rules } : { enabled };
}
