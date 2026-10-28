/** Plain-language text about body access, for the demo command and messages. Pure. */
import type { BodyRefusal } from './body-service';
import type { SectionTree } from './note-sections';

const REASONS: Record<BodyRefusal, string> = {
  'rubric-off': 'Rubric is switched off',
  'body-edits-off': 'the setting “Allow Rubric to edit note bodies” is off',
  unmanaged: 'the note is outside the managed scope, or in the schema folder',
  'no-type': 'no schema matches this note',
  'type-not-enabled': 'its type has no body: { enabled: true } in the schema',
  'newer-schema': 'the note is on a newer schema than this plugin knows',
  conflict: 'the body changed since it was read',
  'heading-not-found': 'there is no such heading',
  'heading-ambiguous': 'several headings match; say which one',
  'inside-code': 'that place is inside a code block',
};

export function refusalText(reason: BodyRefusal): string {
  return REASONS[reason];
}

/** One line per section, indented by depth, with 1-based inclusive line numbers of the whole section. */
export function sectionLines(tree: SectionTree): string[] {
  if (tree.flat.length === 0) return ['(no headings)'];
  return tree.flat.map((s) => {
    let depth = 0;
    for (let p = s.parent; p; p = p.parent) depth++;
    const first = s.line + 1;
    const last = Math.max(first, s.end);
    return `${'  '.repeat(depth)}${'#'.repeat(s.level)} ${s.text || '(empty heading)'}  ·  lines ${first}–${last}`;
  });
}
