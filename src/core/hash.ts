/** Small, fast, non-cryptographic content hash (FNV-1a 32-bit plus length). Used to recognise our own writes. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${text.length}`;
}
