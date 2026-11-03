/**
 * The body module's handler: Enter, Tab and Shift-Tab do what the note type's body rules say, per heading or
 * everywhere (`default`). The common case is timed entries: `Enter: { insert: "- {{time:HH:mm}} " }` starts every
 * new line with the time. Pure: no Obsidian or CodeMirror types; rules, clock and note facts are passed in.
 */
import type { BodyHandler, BodyKeyContext, BodyOutcome } from './body-handlers';
import { ruleFor, RULE_KEYS } from './body-rules';
import type { BodyRules } from './body-rules';
import type { FormulaContext } from './formula';
import { parseTemplate, renderTemplate, templateRegexSource } from './template';
import type { ParsedTemplate } from './template';

export const BODY_RULES_HANDLER_ID = 'body-rules';

export interface RulesHandlerOptions {
  /** The merged body rules of the note's type, or null when it has none. */
  rulesFor(path: string): BodyRules | null;
  /** What placeholders can read: the clock, the file and the note's properties. Null when the note is not known. */
  context(path: string): FormulaContext | null;
  log?(message: string): void;
}

/** Enter on a line that Obsidian should keep handling itself: a different kind of list, a quote, a table, a blank line. */
function leaveToObsidian(ctx: BodyKeyContext): boolean {
  const text = ctx.lineText;
  if (text.trim() === '') return true; // Enter on a blank line makes a blank line: the way out of the entries
  if (/^\s*(>|\|)/.test(text)) return true; // quote and table rows
  if (ctx.list) {
    if (ctx.list.depth > 0 || ctx.list.task || !/^[-*+]$/.test(ctx.list.marker)) return true; // sub-bullets, tasks, numbers
    const marker = /^[ \t]*[-*+][ \t]*/.exec(text);
    if (!marker || text.slice(marker[0].length).trim() === '') return true; // an empty bullet: Obsidian ends the list
  }
  return false;
}

export function makeBodyHandler(options: RulesHandlerOptions): BodyHandler {
  const cache = new Map<string, ParsedTemplate>();
  const parsed = (template: string): ParsedTemplate => {
    let p = cache.get(template);
    if (!p) {
      p = parseTemplate(template);
      if (cache.size > 200) cache.clear();
      cache.set(template, p);
    }
    return p;
  };

  return {
    id: BODY_RULES_HANDLER_ID,
    keys: [...RULE_KEYS],
    mayRewrite: true, // an entry with nothing after it is removed, which ends the list
    handle(ctx: BodyKeyContext): BodyOutcome {
      const rules = options.rulesFor(ctx.path);
      if (!rules) return 'pass';
      const rule = ruleFor(rules, ctx.key, ctx.section);
      if (!rule || rule.pass || rule.insert === undefined || !ctx.selectionEmpty) return 'pass';
      const cx = options.context(ctx.path);
      if (!cx) return 'pass';

      const rendered = renderTemplate(parsed(rule.insert), cx);
      if (rendered.errors.length > 0) options.log?.(`body rule for ${ctx.key} in ${ctx.path}: ${rendered.errors.join('; ')}`);

      // Without a new line the text just goes in at the cursor (Tab and Shift-Tab by default).
      if (!(rule.newline ?? ctx.key === 'Enter')) {
        ctx.tx.insert(rendered.text);
        ctx.tx.setCursor(ctx.cursor.offset);
        return 'claim';
      }

      if (leaveToObsidian(ctx)) return 'pass';

      // Is this line already an entry made from the rule? (The same text with any time, date or word in the placeholders.)
      const start = new RegExp(`^${templateRegexSource(parsed(rule.insert.trimEnd()))}[ \\t]*`).exec(ctx.lineText);
      if (start) {
        // Cursor inside the "- 14:05 " part: the key moves the line down, as usual.
        if (ctx.cursor.ch < start[0].length) return 'pass';
        // An entry with nothing after it, Enter at its end: remove it and leave a blank line.
        if (ctx.lineText.slice(start[0].length).trim() === '' && ctx.cursor.ch >= ctx.lineText.trimEnd().length) {
          const from = ctx.cursor.offset - ctx.cursor.ch;
          ctx.tx.replace(from, from + ctx.lineText.length, '');
          ctx.tx.setCursor(from);
          return 'claim';
        }
      } else if (ctx.cursor.ch === 0) {
        return 'pass'; // Enter at the very start of a line pushes it down
      } else if (ctx.list) {
        const marker = /^[ \t]*[-*+][ \t]*/.exec(ctx.lineText);
        if (marker && ctx.cursor.ch < marker[0].length) return 'pass';
      }

      // The CodeMirror document always uses \n, whatever the file's line endings are.
      ctx.tx.insert(`\n${rendered.text}`);
      ctx.tx.setCursor(ctx.cursor.offset);
      return 'claim';
    },
  };
}
