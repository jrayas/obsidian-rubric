import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';
import type { Document, Node } from 'yaml';

export type YamlPath = (string | number)[];

/** A parsed YAML file that can report the line of any key. */
export class YamlFile {
  readonly path: string;
  private readonly lineCounter = new LineCounter();
  readonly doc: Document.Parsed;

  constructor(path: string, text: string) {
    this.path = path;
    this.doc = parseDocument(text, { lineCounter: this.lineCounter, uniqueKeys: true });
  }

  /** Syntax errors with 1-based line numbers. */
  syntaxErrors(): { line?: number; message: string }[] {
    return this.doc.errors.map((e) => ({
      line: e.linePos?.[0]?.line,
      message: (e.message.split('\n')[0] ?? e.message).replace(/\s+at line \d+, column \d+:?$/, ''),
    }));
  }

  toJS(): unknown {
    return this.doc.toJS();
  }

  private lineOfOffset(offset: number | undefined): number | undefined {
    if (offset === undefined) return undefined;
    return this.lineCounter.linePos(offset).line;
  }

  /** Line of the key at `path` (or of the value when the path ends in an index). */
  lineOf(path: YamlPath): number | undefined {
    if (path.length === 0) return 1;
    const parentPath = path.slice(0, -1);
    const last = path[path.length - 1];
    const parent = (parentPath.length ? this.doc.getIn(parentPath, true) : this.doc.contents) as Node | null | undefined;
    if (parent && isMap(parent) && typeof last === 'string') {
      const pair = (parent.items).find((p) => isScalar(p.key) && String(p.key.value) === last);
      const range = isScalar(pair?.key) ? pair.key.range : undefined;
      if (range) return this.lineOfOffset(range[0]);
    }
    const node = this.doc.getIn(path, true) as Node | undefined;
    return this.lineOfOffset(node?.range?.[0]);
  }
}
