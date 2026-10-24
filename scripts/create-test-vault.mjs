// Build a ready-to-open test vault: the starter schema pack, the built plugin, example notes in every type,
// and a set of notes with deliberate problems for the vault check.
//   npm run build && npm run vault:create          -> dev/testvault
//   node scripts/create-test-vault.mjs <folder>     -> any other folder
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT, DEV, PLUGIN_ID } from './lib/paths.mjs';

const target = resolve(process.argv[2] ?? join(DEV, 'testvault'));
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  if (!existsSync(join(ROOT, f))) {
    console.error(`${f} is missing. Run "npm run build" first.`);
    process.exit(1);
  }
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const put = (rel, text) => {
  const p = join(target, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

// ---- Obsidian config: plugin enabled, templates folder set, nothing else customised ------------------------
const pluginDir = join(target, '.obsidian', 'plugins', PLUGIN_ID);
mkdirSync(pluginDir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(ROOT, f), join(pluginDir, f));
put('.obsidian/community-plugins.json', JSON.stringify([PLUGIN_ID]));
put('.obsidian/templates.json', JSON.stringify({ folder: 'Templates' }, null, 2));
// Settings for trying everything out: new notes in mapped folders fill themselves.
put(`.obsidian/plugins/${PLUGIN_ID}/data.json`, JSON.stringify({ onCreate: 'fill', syncName: true, breadcrumbFromFolder: false }, null, 2));

// ---- the schema pack ---------------------------------------------------------------------------------------
const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const packDir = join(ROOT, 'schema-pack');
for (const f of walk(packDir)) cpSync(f, join(target, '_schema', f.slice(packDir.length + 1)));

// ---- notes -------------------------------------------------------------------------------------------------
const note = (props, body = '') => {
  const lines = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${typeof item === 'string' && /^\[\[|[:#]/.test(item) ? JSON.stringify(item) : item}`);
      }
    } else if (typeof v === 'string' && /^\[\[/.test(v)) lines.push(`${k}: ${JSON.stringify(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
};

const kb = (id, name, extra = {}, body = 'Write here.\n') =>
  note({
    type: 'kb', schema: 2, id, name, status: 'draft', aliases: [], language: 'en-GB',
    breadcrumb: 'Knowledge', related: [], supersedes: [], review_cycle: '6-months',
    kind: 'concept', audience: 'self', confidence: 'medium',
    created: '2026-10-01T09:00', modified: '2026-10-02T09:00', ...extra,
  }, body);

// examples that are fine
put('Knowledge/Physics/Quantum Mechanics.md', kb('KB-2026-0001', 'Quantum Mechanics', { breadcrumb: 'Knowledge/Physics', description: 'Hub for quantum topics.', tags: ['quantum', 'theory'], status: 'published' }, 'An index of notes on quantum mechanics.\n'));
put('Knowledge/Physics/Wave-Particle Duality.md', kb('KB-2026-0002', 'Wave-Particle Duality', {
  breadcrumb: 'Knowledge/Physics/Quantum Mechanics', description: 'Why light and matter show both wave and particle behaviour.', keywords: ['double slit', 'de Broglie'],
  tags: ['quantum', 'theory'], parent: '[[Quantum Mechanics]]', related: ['[[Double-Slit Experiment]]'],
  source_title: 'Lectures on Physics', source_author: 'Richard Feynman', source_accessed: '2026-09-30', review_last: '2026-09-30', review_next: '2027-03-30',
}, 'Hold **Option** (Alt) on `status` or `tags` above to see every allowed value.\n'));
put('Knowledge/Physics/Double-Slit Experiment.md', kb('KB-2026-0003', 'Double-Slit Experiment', { breadcrumb: 'Knowledge/Physics/Quantum Mechanics', tags: ['experiment', 'quantum'], parent: '[[Quantum Mechanics]]', kind: 'how-to' }));
put('Projects/Contract Renewal.md', note({
  type: 'project', schema: 2, id: 'PR-2026-0001', name: 'Contract Renewal', status: 'active', aliases: [], language: 'en-GB', breadcrumb: 'Projects',
  related: [], supersedes: [], priority: 2, start: '2026-10-01', deadline: '2026-11-30', outcome: 'Renewed on better terms.', stakeholders: ['[[Ann Lee]]'],
  created: '2026-10-01T09:00', modified: '2026-10-05T09:00',
}, 'Milestones are task notes whose `project` link points here.\n'));
put('Tasks/Review contract.md', note({
  type: 'task', schema: 2, id: 'TK-2026-0001', name: 'Review contract', status: 'doing', aliases: [], tags: ['policy'], language: 'en-GB',
  related: [], supersedes: [], priority: 2, project: '[[Contract Renewal]]', due: '2026-10-24', depends_on: [],
  created: '2026-10-02T10:15', modified: '2026-10-03T16:40',
}));
put('People/Ann Lee.md', note({
  type: 'person', schema: 2, id: 'PE-2026-0001', name: 'Ann Lee', status: 'active', aliases: [], language: 'en-GB', related: [], supersedes: [],
  relationship: 'colleague', organisation: 'Acme', role: 'Legal counsel', contact_email: 'ann@example.com',
  created: '2026-10-01T09:30', modified: '2026-10-01T09:30',
}));
put('Journal/2026-10-20.md', note({
  type: 'journal', schema: 2, id: 'JR-2026-0001', name: '2026-10-20', status: 'open', aliases: [], language: 'en-GB', related: [], supersedes: [],
  date: '2026-10-20', period: 'daily', mood: 4, energy: 3, highlights: ['Tried the plugin'],
  created: '2026-10-20T07:00', modified: '2026-10-20T21:00',
}, 'Journal notes have no breadcrumb property.\n'));
put('Resources/Feynman Lectures.md', note({
  type: 'resource', schema: 2, id: 'RS-2026-0001', name: 'Feynman Lectures', status: 'in-progress', aliases: [], language: 'en-GB', breadcrumb: 'Resources',
  related: [], supersedes: [], resource_type: 'book', creator: 'Richard Feynman', rating: 5, progress_percent: 40, progress_started: '2026-09-01',
  created: '2026-09-01T08:00', modified: '2026-10-10T08:00',
}));
put('Exercises/Goblet Squat.md', note({
  type: 'exercise', schema: 2, id: 'EX-2026-0001', name: 'Goblet Squat', status: 'reliable', aliases: [], language: 'en-GB', breadcrumb: 'Exercises',
  related: [], supersedes: [], category: 'strength', kind: 'lift', measure: 'reps', equipment: ['kettlebell'], muscles_primary: ['quads', 'glutes'],
  created: '2026-08-01T08:00', modified: '2026-08-01T08:00',
}));
put('Notes/Loose idea.md', note({
  type: 'note', schema: 2, id: 'NT-2026-0001', name: 'Loose idea', status: 'draft', aliases: [], language: 'en-GB', breadcrumb: 'Notes',
  related: [], supersedes: [], confidence: 'low', created: '2026-10-05T12:00', modified: '2026-10-05T12:00',
}));

// notes to try the automation on: they have no properties yet
put('Knowledge/Blank note.md', 'This note has no properties. Try "Choose schema for this note", or Check vault.\n');
put('Inbox/Try me.md', 'Inbox is not mapped to any schema. A new note here asks which schema to use.\n');

// notes with deliberate problems, one per kind of finding (see "Start here")
put('Knowledge/Problems/Needs an ID.md', kb('', 'Needs an ID', {}, 'No ID: the vault check offers to assign one.\n').replace('id: \n', ''));
put('Knowledge/Problems/Bad status.md', kb('KB-2026-0101', 'Bad status', { status: 'live' }, 'Status "live" is not allowed for kb notes.\n'));
put('Knowledge/Problems/Tag synonym.md', kb('KB-2026-0102', 'Tag synonym', { tags: ['sop', 'idea'] }, 'The tag "sop" is a synonym of "procedure".\n'));
put('Knowledge/Problems/Unknown tag.md', kb('KB-2026-0103', 'Unknown tag', { tags: ['zebra'] }, 'The tag "zebra" is not in the vocabulary.\n'));
put('Knowledge/Problems/Body tags.md', kb('KB-2026-0104', 'Body tags', {}, 'Tags typed in the text: #sop is a synonym, #giraffe is unknown. Only reported.\n'));
put('Knowledge/Problems/Duplicate ID older.md', kb('KB-2026-0105', 'Duplicate ID older', { created: '2026-02-01T09:00', modified: '2026-02-02T09:00' }, 'Older note: keeps the ID.\n'));
put('Knowledge/Problems/Duplicate ID newer.md', kb('KB-2026-0105', 'Duplicate ID newer', { created: '2026-06-01T09:00', modified: '2026-06-02T09:00' }, 'Newer note: gets the next free number.\n'));
put('Knowledge/Problems/Old style ID.md', kb('KB-000146', 'Old style ID', { created: '2026-02-03T09:00', modified: '2026-02-04T09:00' }, 'KB-000146 becomes KB-2026-0146.\n'));
put('Knowledge/Problems/Wrong name.md', kb('KB-2026-0106', 'Something else entirely', {}, 'The name property does not match the file name.\n'));
put('Knowledge/Problems/Created after modified.md', kb('KB-2026-0107', 'Created after modified', { created: '2026-09-01T09:00', modified: '2026-08-01T09:00' }, 'Reported only.\n'));
put('Knowledge/Problems/No breadcrumb.md', kb('KB-2026-0108', 'No breadcrumb', { breadcrumb: undefined }, 'A warning, never an error.\n'));
put('Knowledge/Problems/Odd breadcrumb.md', kb('KB-2026-0109', 'Odd breadcrumb', { breadcrumb: 'Nonsense/Folder' }, 'The first segment maps to no schema.\n'));
put('Knowledge/Problems/Leftover domain.md', kb('KB-2026-0110', 'Leftover domain', { domain: 'Knowledge' }, 'domain repeats the breadcrumb, so removing it loses nothing.\n'));
put('Knowledge/Problems/Old schema.md', note({
  type: 'kb', schema: 1, id: 'KB-000201', name: 'Old schema', status: 'draft', breadcrumb: 'Knowledge', created: '2026-02-03T09:00', modified: '2026-02-04T09:00',
  domain: 'Elsewhere',
}, 'Schema 1 note.\n').replace('domain: Elsewhere\n', 'domain: Elsewhere\nsource:\n  title: Lectures\n  author: Feynman\n  notes: free text with nowhere to go\nreview:\n  cycle: 3-months\n  last: 2026-01-01\n'));
put('Knowledge/Problems/Old schema two.md', note({
  type: 'kb', schema: 1, id: 'KB-000202', name: 'Old schema two', status: 'draft', breadcrumb: 'Knowledge', created: '2026-02-05T09:00', modified: '2026-02-06T09:00',
}, 'Another schema 1 note: use "Migrate all kb notes".\n').replace('breadcrumb: Knowledge\n', 'breadcrumb: Knowledge\nsource:\n  title: Another book\nreview:\n  cycle: yearly\n'));
put('Knowledge/Problems/Needs a type change.md', kb('KB-2026-0111', 'Needs a type change', { kind: 'faq', confidence: 'high' }, 'Change the type property to "task": you get a preview and nothing is deleted.\n'));

// a template to try with Obsidian's Templates plugin (Insert template)
put('Templates/Knowledge note.md', '---\nstatus: review\ntags: []\n---\n## Summary\n\n## Details\n\n## Sources\n');

// ---- start here --------------------------------------------------------------------------------------------
put('START HERE.md', `# Vault Schema test vault

This vault has the **Vault Schema** plugin installed with the starter schema in \`_schema/\`. New notes in a mapped
folder fill themselves (the setting is *Settings → Vault Schema → Automation → When a note is created in a mapped folder*).

## First
1. Settings → Community plugins → turn off restricted mode, then enable **Vault Schema** if it is not on already.
2. Open \`Knowledge/Physics/Wave-Particle Duality.md\`.

## Try these
| Try | Expect |
| --- | --- |
| Click the \`status\` value and type "dr" | Only schema values: "draft" |
| Click \`tags\` and type "sop" | "procedure" (a synonym resolves to its preferred term) |
| Hold **Option** (Alt on Windows) on \`status\` | Every allowed value; click one; release to hide |
| Command palette → **Show all options for this property** (assign a hotkey first) | A list that stays open until Escape |
| Click a ▾ button next to a value | The same list |
| Hold the key on \`id\` or \`created\` | A note saying who manages it |
| Create a **new note** in \`Knowledge/\`, type its name, press Enter | It is filled after the name is set: ID, created, status, defaults, and the template body from \`_schema/templates/kb.md\` |
| Rename that note | \`name\` follows the file name |
| Command palette → **Create note from schema** | Pick a type and name; try a name like \`a:b\` |
| Apply the template **Knowledge note** to a new note in \`Knowledge/\` | Template values stay; ID and defaults are added around them |
| Create a note in \`Inbox/\` | The plugin asks which schema to use |
| Open \`Knowledge/Blank note.md\` → **Choose schema for this note** | A preview of what will be added |
| Edit \`type: kb\` to \`type: task\` in \`Knowledge/Problems/Needs a type change.md\` | A conversion preview; old values go to \`archived_fields\` |

## Vault check
Command palette → **Check vault**. The \`Knowledge/Problems/\` folder has one note per kind of finding: a missing ID, a bad
status, a tag synonym, an unknown tag, body tags, duplicate IDs, an old-style ID, a wrong name, created after modified, a
missing and an odd breadcrumb, a leftover domain, and two schema 1 notes (try **Migrate all kb notes**). Every fix shows the
exact change first. Nothing is written until you press a button.

## Schema files
Edit anything in \`_schema/\` (for example the starting body in \`templates/kb.md\`, or add a tag in \`vocabularies/tags.yaml\` or a status in \`types/kb.yaml\`). The plugin
reloads it. Break a file on purpose: you get one notice naming the file and line, and the last good copy stays in use.
\`_schema/REFERENCE.md\` explains every attribute.

Excluded folders (no checks, no prompts): \`Templates\`, \`Archive\`, \`Attachments\`, and \`_schema\`.
`);
mkdirSync(join(target, 'Archive'), { recursive: true });
mkdirSync(join(target, 'Attachments'), { recursive: true });
put('Archive/Old note.md', 'Archived notes are excluded from the schema.\n');

console.log(`Test vault created: ${target}`);
console.log('Open it in Obsidian: Manage vaults -> Open folder as vault.');
