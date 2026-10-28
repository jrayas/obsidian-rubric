/**
 * Reading and writing a note's body. All the rules live here and nothing here knows Obsidian: the file system, the
 * atomic write and the gate come in through `BodyPorts`, so the rules are tested without an app. Pure.
 */
import { changeSize, insertIntoBody } from './body-edit';
import type { HeadingRef, InsertFailure, InsertPosition } from './body-edit';
import type { BodyGate, GateRefusal } from './body-gate';
import type { Eol } from './frontmatter';
import { indexLines, parseSections } from './note-sections';
import type { SectionTree } from './note-sections';
import { joinNote, splitNote } from './note-text';

export interface BodyFile {
  path: string;
}

export interface BodyPorts<F extends BodyFile> {
  /** The note's text (a cached read is fine). */
  read(file: F): Promise<string>;
  /** Atomic read-modify-write of the whole text, in order with other writes to the note (`WriteQueue.process`). */
  process(file: F, transform: (text: string) => string): Promise<{ error?: string; readOnly?: boolean }>;
  gate(file: F): BodyGate;
  /** Is the debug setting on? */
  debug(): boolean;
  log(message: string): void;
}

export type BodyRefusal = GateRefusal | InsertFailure | 'conflict';

export type BodyWrite =
  | { status: 'written'; before: string; after: string }
  /** The body would have been the same; nothing was written. */
  | { status: 'unchanged' }
  | { status: 'refused'; reason: BodyRefusal }
  | { status: 'error'; message: string };

/** What an edit step decides: the new body (null or the same body means nothing to change), or a refusal. */
export type BodyStep = { body: string | null } | { refuse: BodyRefusal };

export interface BodySections extends SectionTree {
  /** Number of frontmatter lines: the file line on which the body starts. */
  firstBodyLine: number;
}

export class BodyService<F extends BodyFile> {
  constructor(private readonly ports: BodyPorts<F>) {}

  // ---- reading: never gated -------------------------------------------------------------------------------------

  async getBody(file: F): Promise<string> {
    return splitNote(await this.ports.read(file)).body;
  }

  async getLines(file: F): Promise<string[]> {
    return indexLines(await this.getBody(file)).lines;
  }

  async getSections(file: F): Promise<BodySections> {
    const parts = splitNote(await this.ports.read(file));
    const firstBodyLine = parts.frontmatter.split('\n').length - 1;
    return { ...parseSections(indexLines(parts.body).lines, firstBodyLine), firstBodyLine };
  }

  canEdit(file: F): BodyGate {
    return this.ports.gate(file);
  }

  // ---- writing --------------------------------------------------------------------------------------------------

  /**
   * Change the body. `fn` gets the body as it is at the moment of the write (never an older copy) and returns the new
   * body, or null for no change. The frontmatter is never touched. `by` names the caller for the debug log.
   */
  editBody(file: F, fn: (body: string, info: { eol: Eol }) => string | null, o: { by: string }): Promise<BodyWrite> {
    return this.transact(file, o.by, (body, eol) => ({ body: fn(body, { eol }) }));
  }

  /** Replace the body, but only if it is still `expectedBody`: a change made since the caller read it is never overwritten. */
  setBody(file: F, text: string, o: { by: string; expectedBody: string }): Promise<BodyWrite> {
    return this.transact(file, o.by, (body) => (body === o.expectedBody ? { body: text } : { refuse: 'conflict' }));
  }

  insertAtSection(file: F, heading: HeadingRef, text: string, position: InsertPosition, o: { by: string }): Promise<BodyWrite> {
    return this.transact(file, o.by, (body, eol) => {
      const r = insertIntoBody(body, heading, text, position, eol);
      return r.ok ? { body: r.changed ? r.body : null } : { refuse: r.reason };
    });
  }

  private async transact(file: F, by: string, step: (body: string, eol: Eol) => BodyStep): Promise<BodyWrite> {
    const gate = this.ports.gate(file);
    if (!gate.allowed) return this.finish(by, file, { status: 'refused', reason: gate.reason });

    let result: BodyWrite = { status: 'unchanged' };
    let outcome: { error?: string; readOnly?: boolean };
    try {
      outcome = await this.ports.process(file, (text) => {
        const parts = splitNote(text);
        const s = step(parts.body, parts.eol);
        if ('refuse' in s) {
          result = { status: 'refused', reason: s.refuse };
          return text;
        }
        if (s.body === null || s.body === parts.body) return text;
        result = { status: 'written', before: parts.body, after: s.body };
        return joinNote({ frontmatter: parts.frontmatter, body: s.body });
      });
    } catch (e) {
      return this.finish(by, file, { status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    if (outcome.readOnly) return this.finish(by, file, { status: 'refused', reason: 'newer-schema' });
    if (outcome.error !== undefined) return this.finish(by, file, { status: 'error', message: outcome.error });
    return this.finish(by, file, result);
  }

  private finish(by: string, file: F, result: BodyWrite): BodyWrite {
    if (this.ports.debug()) {
      if (result.status === 'written') {
        const { added, removed } = changeSize(result.before, result.after);
        this.ports.log(`${by} changed ${file.path} (+${added} −${removed} characters)`);
      } else if (result.status === 'refused') this.ports.log(`${by} was refused on ${file.path}: ${result.reason}`);
      else if (result.status === 'error') this.ports.log(`${by} failed on ${file.path}: ${result.message}`);
    }
    return result;
  }
}
