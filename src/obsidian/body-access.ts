import type { TFile } from 'obsidian';
import { bodyGate } from '../core/body-gate';
import type { BodyGate } from '../core/body-gate';
import { BodyHandlerRegistry } from '../core/body-handlers';
import { BodyService } from '../core/body-service';
import type { BodySections, BodyWrite } from '../core/body-service';
import type { HeadingRef, InsertPosition } from '../core/body-edit';
import type { Eol } from '../core/frontmatter';
import type RubricPlugin from '../main';

/**
 * Reads and edits the body of a note, and holds the body handlers. Nothing in Rubric calls the editing methods yet
 * (D-79): this is the layer later features build on. Reads are never gated; writes need the master switch, the
 * "Allow Rubric to edit note bodies" setting, a managed note and a type with `body: { enabled: true }`.
 * Every write goes through `WriteQueue.process`, which uses `vault.process` (D-80).
 */
export class BodyAccess {
  readonly handlers = new BodyHandlerRegistry();
  private readonly service: BodyService<TFile>;

  constructor(private readonly plugin: RubricPlugin) {
    this.service = new BodyService<TFile>({
      read: (file) => plugin.app.vault.cachedRead(file),
      process: (file, transform) => plugin.queue.process(file, transform),
      gate: (file) => this.canEdit(file),
      debug: () => plugin.settings.debugBodyAccess,
      log: (message) => this.log(message),
    });
  }

  /** Write a line to the developer console. Only called when the debug setting is on. */
  log(message: string): void {
    console.debug(`[Rubric body] ${message}`);
  }

  getBody(file: TFile): Promise<string> {
    return this.service.getBody(file);
  }

  getLines(file: TFile): Promise<string[]> {
    return this.service.getLines(file);
  }

  getSections(file: TFile): Promise<BodySections> {
    return this.service.getSections(file);
  }

  /** May a handler or a write change this note's body right now? The first failing rule is the reason. */
  canEdit(file: TFile): BodyGate {
    const { settings, notes } = this.plugin;
    if (file.extension !== 'md') return { allowed: false, reason: 'unmanaged' };
    const ctx = notes.context(file);
    return bodyGate({
      masterOn: settings.enabled,
      allowBodyEdits: settings.allowBodyEdits,
      verdict: ctx.verdict,
      type: ctx.type,
      frontmatter: ctx.frontmatter,
    });
  }

  editBody(file: TFile, fn: (body: string, info: { eol: Eol }) => string | null, o: { by: string }): Promise<BodyWrite> {
    return this.service.editBody(file, fn, o);
  }

  setBody(file: TFile, text: string, o: { by: string; expectedBody: string }): Promise<BodyWrite> {
    return this.service.setBody(file, text, o);
  }

  insertAtSection(file: TFile, heading: HeadingRef, text: string, position: InsertPosition, o: { by: string }): Promise<BodyWrite> {
    return this.service.insertAtSection(file, heading, text, position, o);
  }
}
