import type { Frontmatter } from './frontmatter';

/** File name without folder and extension. */
export function baseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

/** The folder a note sits in (no trailing slash), or '' for the vault root. */
export function parentFolder(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * After a rename: the new `name`, or null when it should be left alone.
 * `name` follows the file only when it was empty or equal to the old file name (the plugin filled it);
 * a name the user wrote is never overwritten.
 */
export function nameAfterRename(fm: Frontmatter | undefined, oldBase: string, newBase: string): string | null {
  if (!fm || oldBase === newBase) return null;
  const hasPluginProps = 'type' in fm || 'id' in fm;
  if (!hasPluginProps) return null;
  const name = fm.name;
  const empty = name === undefined || name === null || (typeof name === 'string' && name.trim() === '');
  if (empty || name === oldBase) return name === newBase ? null : newBase;
  return null;
}

/** Breadcrumb for a note from its real folder: the folder path, or null for the vault root. */
export function breadcrumbFromPath(path: string): string | null {
  const folder = parentFolder(path);
  return folder === '' ? null : folder;
}
