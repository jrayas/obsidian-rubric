import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { YAMLSeq } from 'yaml';
import { nameKey } from './normalise';
import type { MatchingMode, ScopeMode } from './schema-types';

/**
 * Pure text edits for the two registry files the plugin may write.
 * They use the YAML document model, so comments and the order of other keys are kept.
 */

function open(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error('Cannot edit a file with YAML errors: ' + (doc.errors[0]?.message ?? ''));
  return doc;
}

/** Text of a scalar YAML node, or an empty string. */
function scalarText(node: unknown): string {
  return isScalar(node) && typeof node.value === 'string' ? node.value : '';
}

/** Add or replace one folder -> type mapping. A key that differs only by case or accents is replaced. */
export function setFolderMapping(text: string, folder: string, type: string): string {
  const doc = open(text);
  const key = nameKey(folder);
  const folders = doc.get('folders', true);
  if (isMap(folders)) {
    for (const pair of folders.items) {
      const k = scalarText(pair.key);
      if (nameKey(k) === key) folders.delete(k);
    }
  }
  doc.setIn(['folders', folder], type);
  return doc.toString();
}

/** Remove every mapping whose folder compares equal to `folder`. */
export function removeFolderMapping(text: string, folder: string): string {
  const doc = open(text);
  const key = nameKey(folder);
  const folders = doc.get('folders', true);
  if (isMap(folders)) {
    for (const pair of [...folders.items]) {
      const k = scalarText(pair.key);
      if (nameKey(k) === key) folders.delete(k);
    }
  }
  return doc.toString();
}

export function setMatchingMode(text: string, mode: MatchingMode): string {
  const doc = open(text);
  doc.set('mode', mode);
  return doc.toString();
}

export function setScopeMode(text: string, mode: ScopeMode): string {
  const doc = open(text);
  doc.set('mode', mode);
  return doc.toString();
}

function listIn(doc: ReturnType<typeof open>, key: 'exclude' | 'include'): YAMLSeq {
  let seq = doc.get(key, true);
  if (!isSeq(seq)) {
    doc.set(key, doc.createNode([]));
    seq = doc.get(key, true);
  }
  const s = seq as YAMLSeq;
  s.flow = false;
  return s;
}

/** Add a folder to the exclude or include list (no duplicates, compared ignoring case and accents). */
export function addScopeFolder(text: string, list: 'exclude' | 'include', folder: string): string {
  const doc = open(text);
  const seq = listIn(doc, list);
  const key = nameKey(folder);
  const exists = seq.items.some((i) => nameKey(scalarText(i)) === key);
  if (!exists) seq.add(doc.createNode(folder));
  return doc.toString();
}

export function removeScopeFolder(text: string, list: 'exclude' | 'include', folder: string): string {
  const doc = open(text);
  const seq = doc.get(list, true);
  if (isSeq(seq)) {
    const key = nameKey(folder);
    seq.items = seq.items.filter((i) => nameKey(scalarText(i)) !== key);
    if (seq.items.length === 0) seq.flow = true;
  }
  return doc.toString();
}
