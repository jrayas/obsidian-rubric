import type { TFile } from 'obsidian';
import type { FormulaContext } from '../core/formula';

/** What a body placeholder or formula can read: the clock, the file and the note's properties. */
export function formulaContext(file: TFile, frontmatter: Record<string, unknown> | undefined, now: Date = new Date()): FormulaContext {
  return {
    now,
    file: {
      name: file.name,
      basename: file.basename,
      path: file.path,
      folder: file.parent && !file.parent.isRoot() ? file.parent.path : '',
      ext: file.extension,
      ctime: new Date(file.stat.ctime),
      mtime: new Date(file.stat.mtime),
    },
    props: frontmatter ?? {},
  };
}
