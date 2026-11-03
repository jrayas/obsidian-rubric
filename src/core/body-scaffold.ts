/**
 * Starter sections: the headings (and first lines under them) a new note of a type begins with, in the order the
 * body rules list them. Replaces keeping a template file for each type. Pure: no Obsidian types.
 */
import type { BodyRules } from './body-rules';
import type { FormulaContext } from './formula';
import { renderTemplate } from './template';
import type { Rendered } from './template';

/** The body for a new note, or an empty text when no section is meant for new notes. Lines end with \n. */
export function scaffoldBody(rules: BodyRules, cx: FormulaContext): Rendered {
  const lines: string[] = [];
  const errors: string[] = [];
  for (const section of rules.sections) {
    if (!section.scaffold) continue;
    lines.push(`${'#'.repeat(section.level ?? 2)} ${section.heading}`, '');
    if (section.starter !== undefined && section.starter !== '') {
      const r = renderTemplate(section.starter, cx);
      errors.push(...r.errors);
      lines.push(...r.text.replace(/\n+$/, '').split('\n'), '');
    }
  }
  return { text: lines.length === 0 ? '' : `${lines.join('\n')}\n`, errors };
}
