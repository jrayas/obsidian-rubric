import { Notice } from 'obsidian';
import { refusalText, sectionLines } from '../core/body-report';
import type RubricPlugin from '../main';

/** The command "Body access: show sections" (debug setting): the note's type, whether body access is on for it, and its heading tree. */
export async function showBodySections(plugin: RubricPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file || file.extension !== 'md') {
    new Notice('Open a note first.');
    return;
  }
  const ctx = plugin.notes.context(file);
  const gate = plugin.body.canEdit(file);
  const tree = await plugin.body.getSections(file);
  const type = ctx.type ? `${ctx.type.name}${ctx.type.domain ? ` (${ctx.type.domain})` : ''}` : '(none)';
  const lines = [
    `Type: ${type}`,
    `body.enabled: ${ctx.type ? (ctx.type.body.enabled ? 'on' : 'off') : 'n/a'}`,
    `Body edits: ${gate.allowed ? 'allowed' : `blocked, ${refusalText(gate.reason)}`}`,
    `Headings (body starts at line ${tree.firstBodyLine + 1}):`,
    ...sectionLines(tree),
  ];
  const notice = new Notice('', 20000);
  notice.messageEl.addClass('rubric-body-notice');
  notice.messageEl.setText(lines.join('\n'));
}
