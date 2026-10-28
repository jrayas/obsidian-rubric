/** The `body:` key of a type file: opt-in for the body access layer. Parsed and checked; it carries no behaviour yet. Pure. */
import { isObj, show } from './loader-base';
import type { Loader, Obj } from './loader-base';
import type { YamlFile } from './yaml-file';

export interface BodyConfig {
  /** Handlers may act on notes of this type. False when the type has no `body:`. */
  enabled: boolean;
}

export const NO_BODY: BodyConfig = { enabled: false };

/** Keys under `body:` that mean something. Others are reported as warnings so new keys can be added later without breaking a pack. */
export const BODY_KEYS = new Set(['enabled']);

export function parseBody(ld: Loader, yf: YamlFile, data: Obj): BodyConfig {
  const raw = data.body;
  if (raw === undefined || raw === null) return NO_BODY;
  if (!isObj(raw)) {
    ld.error('body-shape', yf.path, `"body" must be a map such as { enabled: true } (found ${show(raw)})`, yf.lineOf(['body']));
    return NO_BODY;
  }
  for (const key of Object.keys(raw)) {
    if (!BODY_KEYS.has(key)) {
      ld.warn('body-unknown-key', yf.path, `Unknown key "${key}" under "body" (it has no effect; known keys: ${[...BODY_KEYS].join(', ')})`, yf.lineOf(['body', key]));
    }
  }
  if (raw.enabled === undefined) return NO_BODY;
  if (typeof raw.enabled !== 'boolean') {
    ld.error('body-shape', yf.path, `"body.enabled" must be true or false (found ${show(raw.enabled)})`, yf.lineOf(['body', 'enabled']));
    return NO_BODY;
  }
  return { enabled: raw.enabled };
}
