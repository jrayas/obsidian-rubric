import { EditorSelection, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { handleBodyKey } from '../core/body-handlers';
import type { BodyKey } from '../core/body-handlers';
import type RubricPlugin from '../main';

/**
 * The one CodeMirror extension that lets body handlers claim a key. It runs before Obsidian's own handling of the key
 * (D-81) and gives the key back when no handler claims it. What a handler records is applied as a single transaction,
 * so it is one undo step; its `rubric.body` user event is never joined with typing. With no handler registered the
 * extension returns on its first line, so it changes nothing.
 */
export function bodyEditorExtension(plugin: RubricPlugin): Extension {
  const run =
    (key: BodyKey) =>
    (view: EditorView): boolean => {
      const registry = plugin.body.handlers;
      if (!registry.listensTo(key) || view.state.readOnly) return false;
      const file = view.state.field(editorInfoField, false)?.file;
      if (!file) return false;
      const sel = view.state.selection;
      const result = handleBodyKey(registry, {
        key,
        path: file.path,
        composing: view.composing || view.compositionStarted,
        multipleSelections: sel.ranges.length > 1,
        gate: () => plugin.body.canEdit(file),
        text: () => view.state.doc.toString(),
        selection: { anchor: sel.main.anchor, head: sel.main.head },
        tabSize: view.state.tabSize,
        log: (message) => {
          if (plugin.settings.debugBodyAccess) plugin.body.log(message);
        },
      });
      if (!result.claimed) return false;
      if (result.changes.length > 0 || result.cursor !== null) {
        const changes = view.state.changes(result.changes);
        view.dispatch({
          changes,
          ...(result.cursor !== null ? { selection: EditorSelection.cursor(changes.mapPos(result.cursor, 1)) } : {}),
          userEvent: 'rubric.body',
          scrollIntoView: true,
        });
      }
      if (plugin.settings.debugBodyAccess) {
        const added = result.changes.reduce((n, c) => n + c.insert.length, 0);
        const removed = result.changes.reduce((n, c) => n + (c.to - c.from), 0);
        plugin.body.log(`${result.handler} changed ${file.path} (+${added} −${removed} characters)`);
      }
      return true;
    };

  return Prec.highest(
    keymap.of([
      { key: 'Enter', run: run('Enter') },
      { key: 'Tab', run: run('Tab') },
      { key: 'Shift-Tab', run: run('Shift-Tab') },
    ]),
  );
}
