import { nameKey } from './normalise';

export const DEFAULT_SCHEMA_FOLDER = '_schema';
export const HIDDEN_SCHEMA_FOLDER = '.schema';

export interface FolderDetection {
  /** The folder to use (as it exists on disk when found, else the configured name). */
  folder: string;
  exists: boolean;
  /** Name starts with a dot, so Obsidian does not index it. */
  hidden: boolean;
  warnings: string[];
}

/**
 * Decide which schema folder to use.
 * `existing` is the set of root-level folder names that exist (hidden ones included).
 * The setting decides; if both `_schema` and `.schema` exist the other one only produces a warning.
 */
export function detectSchemaFolder(configured: string, existing: Iterable<string>): FolderDetection {
  const names = [...existing];
  const find = (wanted: string) => names.find((n) => nameKey(n) === nameKey(wanted));

  const name = configured.trim() || DEFAULT_SCHEMA_FOLDER;
  const found = find(name);
  const warnings: string[] = [];

  const pair = [DEFAULT_SCHEMA_FOLDER, HIDDEN_SCHEMA_FOLDER];
  if (pair.some((p) => nameKey(p) === nameKey(name))) {
    const other = pair.find((p) => nameKey(p) !== nameKey(name)) as string;
    const otherFound = find(other);
    if (found && otherFound) {
      warnings.push(`Both "${found}" and "${otherFound}" exist. Using "${found}" as set in settings; "${otherFound}" is ignored.`);
    } else if (!found && otherFound) {
      warnings.push(`No "${name}" folder, but "${otherFound}" exists. Change the schema folder name in settings to use it.`);
    }
  }
  const folder = found ?? name;
  return { folder, exists: found !== undefined, hidden: folder.startsWith('.'), warnings };
}

/** True when `path` is the schema folder or inside it (compared ignoring case and accents). */
export function isInSchemaFolder(path: string, schemaFolder: string): boolean {
  const first = path.split('/')[0] ?? '';
  return nameKey(first) === nameKey(schemaFolder);
}
