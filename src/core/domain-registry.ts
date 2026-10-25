/**
 * `registry/domains.yaml`: the list of domains, registered like types. Each entry may give a two-letter `prefix` (used by
 * `unique_id`; a domain without one gets no unique ID), a `folder` name (default: the domain's own name) and a
 * `description`. `default` names the domain a note gets when it has none and no folder names one. The file is optional:
 * without it the domains come from the `domain` property's own `values` (and `prefixes`), as in earlier packs.
 */
import { Loader, isObj, show } from './loader-base';
import { nameKey } from './normalise';
import type { DomainRegistryEntry } from './schema-types';

export const DOMAINS_FILE = 'registry/domains.yaml';

/** A domain name is a lowercase slug: it is a file name, a folder name and the prefix of section values. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ENTRY_KEYS = new Set(['prefix', 'folder', 'description']);

export interface DomainRegistry {
  names: string[];
  entries: Map<string, DomainRegistryEntry>;
  /** The default domain; the first one when the file names none. */
  defaultDomain: string;
}

/** Read and check the domain registry. Null when there is no file (or it could not be read: the problem is recorded). */
export async function loadDomainRegistry(ld: Loader): Promise<DomainRegistry | null> {
  const f = await ld.readYaml(DOMAINS_FILE, true);
  if (!f) return null;
  const file = DOMAINS_FILE;
  if (!isObj(f.data)) {
    ld.error('domains-shape', file, 'domains.yaml must be a map with a "domains" map', 1);
    return null;
  }
  const raw = f.data.domains;
  if (!isObj(raw) || Object.keys(raw).length === 0) {
    ld.error('domains-shape', file, 'domains.yaml needs a "domains" map listing at least one domain', f.file.lineOf(['domains']) ?? 1);
    return null;
  }
  const entries = new Map<string, DomainRegistryEntry>();
  const prefixOwner = new Map<string, string>();
  const folderOwner = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    const line = f.file.lineOf(['domains', name]);
    if (!SLUG.test(name)) {
      ld.error('domains-name', file, `Domain "${name}" must be lowercase letters, digits and single hyphens (it is a file name, a folder name and the start of section values)`, line);
      continue;
    }
    if (value !== null && value !== undefined && !isObj(value)) {
      ld.error('domains-shape', file, `Domain "${name}" must be a map such as { prefix: MA } (or {})`, line);
      continue;
    }
    const d: Record<string, unknown> = isObj(value) ? value : {};
    for (const key of Object.keys(d)) {
      if (!ENTRY_KEYS.has(key)) ld.warn('unknown-attribute', file, `Domain "${name}": unknown attribute "${key}"`, f.file.lineOf(['domains', name, key]));
    }
    const entry: DomainRegistryEntry = { folder: name, ...(line !== undefined ? { line } : {}) };
    if (d.prefix !== undefined) {
      if (typeof d.prefix !== 'string' || !/^[A-Z]{2}$/.test(d.prefix)) {
        ld.error('prefixes', file, `Domain "${name}": the prefix must be two capital letters`, f.file.lineOf(['domains', name, 'prefix']) ?? line);
      } else if (prefixOwner.has(d.prefix)) {
        ld.error('prefixes', file, `Domains "${prefixOwner.get(d.prefix) ?? ''}" and "${name}" both use the prefix ${d.prefix}`, f.file.lineOf(['domains', name, 'prefix']) ?? line);
      } else {
        prefixOwner.set(d.prefix, name);
        entry.prefix = d.prefix;
      }
    }
    if (d.folder !== undefined) {
      if (typeof d.folder !== 'string' || d.folder.trim() === '' || /[\\/]/.test(d.folder)) {
        ld.error('domains-folder', file, `Domain "${name}": "folder" must be one folder name, without a slash`, f.file.lineOf(['domains', name, 'folder']) ?? line);
      } else entry.folder = d.folder.trim();
    }
    const key = nameKey(entry.folder);
    if (folderOwner.has(key)) {
      ld.error('domains-folder', file, `Domains "${folderOwner.get(key) ?? ''}" and "${name}" both use the folder "${entry.folder}" (names are compared ignoring case and accents)`, line);
    } else folderOwner.set(key, name);
    if (typeof d.description === 'string') entry.description = d.description;
    entries.set(name, entry);
  }
  const names = [...entries.keys()];
  if (names.length === 0) return null;
  let defaultDomain = names[0] as string;
  if (f.data.default !== undefined) {
    if (typeof f.data.default === 'string' && entries.has(f.data.default)) defaultDomain = f.data.default;
    else ld.error('domains-default', file, `"default" must be one of the listed domains (found ${show(f.data.default)})`, f.file.lineOf(['default']));
  }
  return { names, entries, defaultDomain };
}
