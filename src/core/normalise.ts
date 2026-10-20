/** Folder-name comparison key: ignores case and accents, and Unicode composition (macOS stores NFD). */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim();
}

/** First path segment of a `/`-separated path. */
export function firstSegment(path: string): string {
  return path.split('/').find((s) => s.length > 0) ?? '';
}
