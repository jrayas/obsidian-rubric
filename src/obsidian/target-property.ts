import { MarkdownView, getFrontMatterInfo } from 'obsidian';
import type { App, TFile } from 'obsidian';

export interface TargetProperty {
  file: TFile;
  key: string;
}

/** The property the user is on: a focused row in the Properties panel, or the cursor line in source mode. */
export function propertyUnderFocus(app: App): TargetProperty | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file ?? app.workspace.getActiveFile();
  if (!file || file.extension !== 'md') return null;

  const row = activeDocument.activeElement?.closest<HTMLElement>('.metadata-property[data-property-key]');
  const rowKey = row?.dataset.propertyKey;
  if (rowKey) return { file, key: rowKey };

  const editor = view?.editor;
  if (!editor) return null;
  const info = getFrontMatterInfo(editor.getValue());
  if (!info.exists) return null;
  const cursor = editor.getCursor();
  const first = editor.offsetToPos(info.from).line;
  const last = editor.offsetToPos(info.to).line;
  if (cursor.line < first || cursor.line > last) return null;
  for (let line = cursor.line; line >= first; line--) {
    const m = /^([^\s#:-][^:]*):/.exec(editor.getLine(line));
    if (m?.[1]) return { file, key: m[1].trim() };
  }
  return null;
}
