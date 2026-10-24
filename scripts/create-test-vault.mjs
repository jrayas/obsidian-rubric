// Build a ready-to-open test vault: the starter schema pack, the built plugin, example notes in every type and domain,
// and a set of notes with deliberate problems for the vault check.
//   npm run build && npm run vault:create          -> dev/testvault
//   node scripts/create-test-vault.mjs <folder>     -> any other folder
//   node scripts/create-test-vault.mjs <folder> --no-plugin    skip the plugin files (used by the tests)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT, DEV, PLUGIN_ID } from './lib/paths.mjs';

const args = process.argv.slice(2);
const withPlugin = !args.includes('--no-plugin');
const target = resolve(args.find((a) => !a.startsWith('--')) ?? join(DEV, 'testvault'));
if (withPlugin) {
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    if (!existsSync(join(ROOT, f))) {
      console.error(`${f} is missing. Run "npm run build" first.`);
      process.exit(1);
    }
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
if (withPlugin) {
  const pluginDir = join(target, '.obsidian', 'plugins', PLUGIN_ID);
  mkdirSync(pluginDir, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(ROOT, f), join(pluginDir, f));
  put('.obsidian/community-plugins.json', JSON.stringify([PLUGIN_ID]));
  put('.obsidian/templates.json', JSON.stringify({ folder: 'Templates' }, null, 2));
  // Settings for trying everything out: Rubric is switched on (a fresh install starts off) and new notes in mapped folders fill themselves.
  put(`.obsidian/plugins/${PLUGIN_ID}/data.json`, JSON.stringify({ enabled: true, onCreate: 'fill', syncName: true, breadcrumbFromFolder: false }, null, 2));
}

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
// A text value is quoted when plain YAML would misread it: a colon and a space, a leading symbol, a link, or " #".
const needsQuotes = (v) => typeof v === 'string' && (/^\[\[/.test(v) || /: |:$|\s#|^[\[\]{}&*!|>'"%@`#,?-]/.test(v) || /^(true|false|null|yes|no|~)$/i.test(v));
const yamlValue = (k, v) => {
  if (Array.isArray(v)) {
    if (v.length === 0) return [`${k}: []`];
    return [`${k}:`, ...v.map((item) => `  - ${needsQuotes(item) ? JSON.stringify(item) : item}`)];
  }
  return [`${k}: ${needsQuotes(v) ? JSON.stringify(v) : v}`];
};
const note = (props, body = '') => {
  const lines = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    lines.push(...yamlValue(k, v));
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
};

// The order the schema writes properties in: modules in the order of `uses`, then the type's own, then anything a domain
// adds, then created and modified. A helper keeps every example in that order, so the vault check has nothing to say.
const LEARNING = [
  'type', 'schema', 'id', 'name', 'status', 'aliases', 'description', 'keywords', 'tags', 'language', 'parent', 'related', 'supersedes', 'superseded_by',
];
const KB_ORDER = [
  ...LEARNING, 'source_title', 'source_author', 'source_url', 'source_accessed', 'review_cycle', 'review_last', 'review_next', 'prerequisites', 'next', 'companion',
  'domain', 'unique_id', 'section', 'level', 'topic', 'order', 'track', 'ai_generated', 'generated_by', 'verified', 'verified_by', 'references', 'kind', 'audience', 'confidence',
];
const CURRICULUM_ORDER = (own) => [
  ...LEARNING, 'review_cycle', 'review_last', 'review_next', 'prerequisites', 'next', 'companion',
  'domain', 'unique_id', 'section', 'level', 'topic', 'order', 'track', 'ai_generated', 'generated_by', 'verified', 'verified_by', 'references', ...own,
];
const EXERCISE_ORDER = CURRICULUM_ORDER(['difficulty', 'time_minutes', 'tests', 'answer_verified', 'confidence']);
const SCENARIO_ORDER = CURRICULUM_ORDER(['decision_type', 'difficulty', 'time_minutes', 'tests', 'senior_signal', 'answer_verified', 'confidence']);
const EXAMPLE_ORDER = CURRICULUM_ORDER(['demonstrates', 'difficulty', 'confidence']);
const ordered = (order, props) => {
  const out = {};
  for (const k of order) if (k in props) out[k] = props[k];
  for (const k of Object.keys(props)) if (!(k in out) && k !== 'created' && k !== 'modified') out[k] = props[k]; // what a domain adds
  if ('created' in props) out.created = props.created;
  if ('modified' in props) out.modified = props.modified;
  return out;
};

const DOMAIN_PREFIX = { general: 'GE', maths: 'MA', physics: 'PY', pcb: 'PC', embedded: 'EM' };
const FIRST_SECTION = { general: 'general-start-here', maths: 'maths-foundations', physics: 'physics-mechanics', pcb: 'pcb-foundations', embedded: 'embedded-foundations' };
const common = (domain, unique, extra = {}) => ({
  domain, unique_id: unique, section: FIRST_SECTION[domain], level: 'beginner', order: 10, track: [], ai_generated: false, verified: false, ...extra,
});
const stamps = { created: '2026-10-01T09:00', modified: '2026-10-02T09:00' };

const kb = (id, name, domain, unique, extra = {}, body = 'Write here.\n') =>
  note(ordered(KB_ORDER, {
    type: 'kb', schema: 2, id, name, status: 'draft', aliases: [], language: 'en-GB', related: [], supersedes: [], review_cycle: '6-months',
    prerequisites: [], ...common(domain, unique), kind: 'concept', audience: 'self', confidence: 'medium', ...stamps, ...extra,
  }), body);
const exercise = (id, name, domain, unique, extra = {}, body = '') =>
  note(ordered(EXERCISE_ORDER, {
    type: 'exercise', schema: 1, id, name, status: 'draft', aliases: [], language: 'en-GB', related: [], supersedes: [], review_cycle: '6-months',
    prerequisites: [], ...common(domain, unique), difficulty: 'beginner', time_minutes: 10, answer_verified: false, confidence: 'medium', ...stamps, ...extra,
  }), body || '> [!question] Question\n> Write the question here.\n\n> [!success]- Answer\n> Write the answer here.\n');
const scenario = (id, name, domain, unique, extra = {}) =>
  note(ordered(SCENARIO_ORDER, {
    type: 'scenario', schema: 1, id, name, status: 'draft', aliases: [], language: 'en-GB', related: [], supersedes: [], review_cycle: '6-months',
    prerequisites: [], ...common(domain, unique), decision_type: 'diagnosis', difficulty: 'intermediate', time_minutes: 15, answer_verified: false, confidence: 'low', ...stamps, ...extra,
  }), '> [!question] Situation\n> Describe the situation.\n\n> [!success]- What to do and why\n> The reasoning.\n');
const example = (id, name, domain, unique, extra = {}) =>
  note(ordered(EXAMPLE_ORDER, {
    type: 'example', schema: 1, id, name, status: 'draft', aliases: [], language: 'en-GB', related: [], supersedes: [], review_cycle: '6-months',
    prerequisites: [], ...common(domain, unique), difficulty: 'beginner', confidence: 'medium', ...stamps, ...extra,
  }), 'A worked example.\n');

// ---- examples that are fine: knowledge notes in every domain ----------------------------------------------
put('Knowledge/general/Getting started.md', kb('KB-2026-0001', 'Getting started', 'general', 'KB-GE-2026-0001', { description: 'Start here: how this vault is organised.', track: ['general-getting-started'], kind: 'index', tags: ['learning'] }, 'The general domain has no override files: it is the default schema.\n'));
put('Knowledge/maths/Limits.md', kb('KB-2026-0002', 'Limits', 'maths', 'KB-MA-2026-0001', {
  description: 'What it means for a sequence to approach a value.', kind: 'definition', audience: undefined, tags: ['calculus'], track: ['maths-first-course'], order: 10,
}, 'Maths notes have their own kinds (definition, theorem, proof, example) and no audience property.\n'));
put('Knowledge/maths/Triangle inequality.md', kb('KB-2026-0003', 'Triangle inequality', 'maths', 'KB-MA-2026-0002', {
  description: 'The length of one side is at most the sum of the other two.', kind: 'theorem', audience: undefined, section: 'maths-analysis', order: 20,
  tags: ['theorem', 'proof'], track: ['maths-first-course'], prerequisite_theorems: ['[[Limits]]'], prerequisites: ['[[Limits]]'],
}, 'This note adds prerequisite_theorems, a property only the maths domain has.\n'));
put('Knowledge/physics/Second law of motion.md', kb('KB-2026-0004', 'Second law of motion', 'physics', 'KB-PY-2026-0001', {
  description: 'Force equals mass times acceleration.', kind: 'law', section: 'physics-mechanics', tags: ['mechanics'], track: ['physics-first-course'], units: 'N', formula: 'F = m a',
}, 'Physics notes add units and a formula.\n'));
put('Knowledge/pcb/Decoupling capacitors.md', kb('KB-2026-0005', 'Decoupling capacitors', 'pcb', 'KB-PC-2026-0001', {
  description: 'Why every power pin needs a small capacitor close by.', kind: 'how-to', section: 'pcb-power-thermal', tags: ['decoupling'], track: ['pcb-first-board'], standards: ['IPC-2221'],
}, 'Engineering domains add standards. Try "bypassing": it is a synonym of "decoupling" in this domain only.\n'));
put('Knowledge/embedded/Interrupt latency.md', kb('KB-2026-0006', 'Interrupt latency', 'embedded', 'KB-EM-2026-0001', {
  description: 'How long it takes from a signal to the first line of the handler.', kind: 'concept', section: 'embedded-rtos', tags: ['interrupts'], track: ['embedded-real-time'],
  target_mcu: 'STM32F4', toolchain: 'arm-none-eabi-gcc', standards: [],
}, 'Embedded notes add a target, a toolchain and standards.\n'));

// ---- the learning types, in the domains that change them --------------------------------------------------
put('Exercises/maths/Prove the triangle inequality.md', exercise('EX-2026-0001', 'Prove the triangle inequality', 'maths', 'EX-MA-2026-0001', {
  difficulty: 'intermediate', time_minutes: 20, tests: ['[[Triangle inequality]]'], section: 'maths-analysis', question_kind: 'proof-writing',
}));
put('Exercises/pcb/Size a decoupling capacitor.md', exercise('EX-2026-0002', 'Size a decoupling capacitor', 'pcb', 'EX-PC-2026-0001', {
  tests: ['[[Decoupling capacitors]]'], section: 'pcb-power-thermal', tools_needed: ['calculator'],
}));
put('Scenarios/pcb/The board resets under load.md', scenario('SC-2026-0001', 'The board resets under load', 'pcb', 'SC-PC-2026-0001', {
  decision_type: 'diagnosis', tests: ['[[Decoupling capacitors]]'], section: 'pcb-power-thermal', senior_signal: 'Looks at the supply rail with a scope before changing the layout.',
}));
put('Scenarios/embedded/Missed deadlines in the RTOS.md', scenario('SC-2026-0002', 'Missed deadlines in the RTOS', 'embedded', 'SC-EM-2026-0001', {
  decision_type: 'real-time', tests: ['[[Interrupt latency]]'], section: 'embedded-rtos', senior_signal: 'Measures before moving priorities.',
}));
put('Examples/maths/Limit of one over n.md', example('EG-2026-0001', 'Limit of one over n', 'maths', 'EG-MA-2026-0001', { demonstrates: '[[Limits]]' }));

// ---- the everyday and personal types (no domain) ----------------------------------------------------------
put('Projects/Contract Renewal.md', note({
  type: 'project', schema: 2, id: 'PR-2026-0001', name: 'Contract Renewal', status: 'active', aliases: [], language: 'en-GB',
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
}, 'Journal notes have no domain.\n'));
put('Resources/Feynman Lectures.md', note({
  type: 'resource', schema: 2, id: 'RS-2026-0001', name: 'Feynman Lectures', status: 'in-progress', aliases: [], language: 'en-GB',
  related: [], supersedes: [], resource_type: 'book', creator: 'Richard Feynman', rating: 5, progress_percent: 40, progress_started: '2026-09-01',
  created: '2026-09-01T08:00', modified: '2026-10-10T08:00',
}));
put('Workouts/Goblet Squat.md', note({
  type: 'workout', schema: 1, id: 'WK-2026-0001', name: 'Goblet Squat', status: 'reliable', aliases: [], language: 'en-GB',
  related: [], supersedes: [], category: 'strength', kind: 'lift', measure: 'reps', equipment: ['kettlebell'], muscles_primary: ['quads', 'glutes'],
  created: '2026-08-01T08:00', modified: '2026-08-01T08:00',
}));
put('Notes/Loose idea.md', note({
  type: 'note', schema: 2, id: 'NT-2026-0001', name: 'Loose idea', status: 'draft', aliases: [], language: 'en-GB',
  related: [], supersedes: [], confidence: 'low', created: '2026-10-05T12:00', modified: '2026-10-05T12:00',
}));

// notes to try the automation on: they have no properties yet
put('Knowledge/Blank note.md', 'This note has no properties. Try "Choose schema for this note", or Check vault.\n');
put('Inbox/Try me.md', 'Inbox is not mapped to any schema. A new note here asks which schema to use.\n');

// ---- notes with deliberate problems, one per kind of finding (see "Start here") ----------------------------
put('Knowledge/Problems/Needs an ID.md', kb('', 'Needs an ID', 'general', 'KB-GE-2026-0050', {}, 'No ID: the vault check offers to assign one.\n').replace('id: \n', ''));
put('Knowledge/Problems/Bad status.md', kb('KB-2026-0101', 'Bad status', 'general', 'KB-GE-2026-0051', { status: 'live' }, 'Status "live" is not allowed for kb notes.\n'));
put('Knowledge/Problems/Tag synonym.md', kb('KB-2026-0102', 'Tag synonym', 'general', 'KB-GE-2026-0052', { tags: ['sop', 'idea'] }, 'The tag "sop" is a synonym of "procedure".\n'));
put('Knowledge/Problems/Unknown tag.md', kb('KB-2026-0103', 'Unknown tag', 'general', 'KB-GE-2026-0053', { tags: ['zebra'] }, 'The tag "zebra" is not in the vocabulary.\n'));
put('Knowledge/Problems/Body tags.md', kb('KB-2026-0104', 'Body tags', 'general', 'KB-GE-2026-0054', {}, 'Tags typed in the text: #sop is a synonym, #giraffe is unknown. Only reported.\n'));
put('Knowledge/Problems/Duplicate ID older.md', kb('KB-2026-0105', 'Duplicate ID older', 'general', 'KB-GE-2026-0055', { created: '2026-02-01T09:00', modified: '2026-02-02T09:00' }, 'Older note: keeps the ID.\n'));
put('Knowledge/Problems/Duplicate ID newer.md', kb('KB-2026-0105', 'Duplicate ID newer', 'general', 'KB-GE-2026-0056', { created: '2026-06-01T09:00', modified: '2026-06-02T09:00' }, 'Newer note: gets the next free number.\n'));
put('Knowledge/Problems/Old style ID.md', kb('KB-000146', 'Old style ID', 'general', 'KB-GE-2026-0057', { created: '2026-02-03T09:00', modified: '2026-02-04T09:00' }, 'KB-000146 becomes KB-2026-0146.\n'));
put('Knowledge/Problems/Wrong name.md', kb('KB-2026-0106', 'Something else entirely', 'general', 'KB-GE-2026-0058', {}, 'The name property does not match the file name.\n'));
put('Knowledge/Problems/Created after modified.md', kb('KB-2026-0107', 'Created after modified', 'general', 'KB-GE-2026-0059', { created: '2026-09-01T09:00', modified: '2026-08-01T09:00' }, 'Reported only.\n'));
// the domain rules
put('Knowledge/Problems/No unique ID.md', kb('KB-2026-0120', 'No unique ID', 'pcb', undefined, { section: 'pcb-foundations', kind: 'how-to', standards: [] }, 'A pcb note without a unique_id: the vault check offers KB-PC-2026-0004.\n'));
put('Knowledge/Problems/Unique ID of another domain.md', kb('KB-2026-0121', 'Unique ID of another domain', 'pcb', 'KB-MA-2026-0090', { section: 'pcb-foundations', kind: 'how-to', standards: [] }, 'The unique_id says maths but the domain is pcb: it is issued again and the old one is kept in archived_fields.\n'));
put('Knowledge/Problems/Section of another domain.md', kb('KB-2026-0122', 'Section of another domain', 'pcb', 'KB-PC-2026-0002', { section: 'maths-algebra', kind: 'how-to', standards: [] }, 'A maths section in a pcb note: not allowed here, and it does not start with pcb-.\n'));
put('Knowledge/Problems/Kind of another domain.md', kb('KB-2026-0123', 'Kind of another domain', 'pcb', 'KB-PC-2026-0003', { section: 'pcb-foundations', kind: 'theorem', standards: [] }, 'The kind "theorem" belongs to maths; pcb has how-to, troubleshooting, checklist, concept, reference and case-study.\n'));
put('Knowledge/Problems/Property the domain removed.md', kb('KB-2026-0124', 'Property the domain removed', 'maths', 'KB-MA-2026-0093', { kind: 'definition', audience: 'self' }, 'The maths domain removes audience, so this note should not have it. Reported only, never deleted.\n'));
// migration: schema 1 notes with nested blocks
put('Knowledge/Problems/Old schema.md', note({
  type: 'kb', schema: 1, id: 'KB-000201', name: 'Old schema', status: 'draft', created: '2026-02-03T09:00', modified: '2026-02-04T09:00',
}, 'Schema 1 note.\n').replace('status: draft\n', 'status: draft\nsource:\n  title: Lectures\n  author: Feynman\n  notes: free text with nowhere to go\nreview:\n  cycle: 3-months\n  last: 2026-01-01\n'));
put('Knowledge/Problems/Old schema two.md', note({
  type: 'kb', schema: 1, id: 'KB-000202', name: 'Old schema two', status: 'draft', created: '2026-02-05T09:00', modified: '2026-02-06T09:00',
}, 'Another schema 1 note: use "Migrate all kb notes".\n').replace('status: draft\n', 'status: draft\nsource:\n  title: Another book\nreview:\n  cycle: yearly\n'));
put('Knowledge/Problems/Needs a type change.md', kb('KB-2026-0111', 'Needs a type change', 'general', 'KB-GE-2026-0060', { kind: 'faq', confidence: 'high' }, 'Change the type property to "task": you get a preview and nothing is deleted.\n'));

// a template to try with Obsidian's Templates plugin (Insert template)
put('Templates/Knowledge note.md', '---\nstatus: review\ntags: []\n---\n## Summary\n\n## Details\n\n## Sources\n');

// ---- start here --------------------------------------------------------------------------------------------
put('START HERE.md', `# Rubric test vault

This vault has the **Rubric** plugin installed and **switched on**, with the starter schema in \`_schema/\`. (A fresh install
starts switched off; the status bar says "Rubric: on" or "Rubric: off", and clicking it toggles.) New notes in a mapped
folder fill themselves (*Settings → Rubric → Automation → When a note is created in a mapped folder*).

## First
1. Settings → Community plugins → turn off restricted mode, then enable **Rubric** if it is not on already.
2. Open \`Knowledge/maths/Triangle inequality.md\`.

## The domains
Every knowledge, exercise, scenario and example note has a **domain**. The schema is the same for all of them, and each
domain changes only what it needs, in override files next to the defaults (\`_schema/types/kb/maths.yaml\` and so on).

| Domain | Prefix | Try |
| --- | --- | --- |
| \`general\` | GE | No override files: it is the default. Look at \`Knowledge/general/Getting started.md\` |
| \`maths\` | MA | \`kind\` offers definition, theorem, proof, example; no \`audience\`; an extra \`prerequisite_theorems\` |
| \`physics\` | PY | Extra \`units\` and \`formula\`; kinds law, derivation, experiment |
| \`pcb\` | PC | Extra \`standards\`; kinds how-to, troubleshooting, checklist. The tag "bypassing" becomes "decoupling" here only |
| \`embedded\` | EM | Extra \`target_mcu\`, \`toolchain\`, \`standards\` |

Each note has two IDs: \`id\` (\`KB-2026-0005\`, the one to link by, never changes) and \`unique_id\` (\`KB-PC-2026-0001\`, a readable label
per type, domain and year). Change a note's \`domain\` and you are offered a new \`unique_id\`; the old one is kept in \`archived_fields\`.
Open \`_schema/preview/\` to see what a new note starts with: \`kb.yaml\` for the default and \`kb/pcb.yaml\` for pcb.

## Try these
| Try | Expect |
| --- | --- |
| Click the \`status\` value and type "dr" | Only schema values: "draft" |
| Click \`kind\` in a maths note, then in a pcb note | Different lists |
| Click \`tags\` and type "sop" | "procedure" (a synonym resolves to its preferred term) |
| Hold **Option** (Alt on Windows) on \`status\` | Every allowed value; click one; release to hide |
| Command palette → **Show all options for this property** (assign a hotkey first) | A list that stays open until Escape |
| Hold the key on \`id\`, \`unique_id\` or \`created\` | A note saying who manages it |
| Create a **new note** in \`Knowledge/\` | It fills itself: ID, unique ID, created, status, defaults (domain general) |
| Change that note's \`domain\` to \`pcb\` | A preview of a new \`unique_id\` |
| Command palette → **Create note from schema** | Pick a type and name |
| Create a note in \`Inbox/\` | The plugin asks which schema to use |
| Open \`Knowledge/Blank note.md\` → **Choose schema for this note** | A preview of what will be added |
| Click **Rubric: on** in the status bar | It switches off: no stamps, no prompts, nothing written. Click again to switch on |

## Vault check
Command palette → **Check vault**. The \`Knowledge/Problems/\` folder has one note per kind of finding: a missing ID, a bad status,
a tag synonym, an unknown tag, body tags, duplicate IDs, an old-style ID, a wrong name, created after modified, and the domain
rules: no unique ID, a unique ID of another domain, a section of another domain, a kind of another domain, and a property the
domain removed. Two schema 1 notes let you try **Migrate all kb notes**. Every fix shows the exact change first. Nothing is
written until you press a button.

## Schema files
\`_schema/REFERENCE.md\` is the full reference: every file, every attribute, every domain, every error code. Edit anything in
\`_schema/\` (for example add a tag in \`vocabularies/tags/pcb.yaml\`). The plugin reloads it. Break a file on purpose: you get one
notice naming the file and line, and the last good copy stays in use.

Excluded folders (no checks, no prompts): \`Templates\`, \`Archive\`, \`Attachments\`, and \`_schema\`.
`);
mkdirSync(join(target, 'Archive'), { recursive: true });
mkdirSync(join(target, 'Attachments'), { recursive: true });
put('Archive/Old note.md', 'Archived notes are excluded from the schema.\n');

console.log(`Test vault created: ${target}`);
console.log('Open it in Obsidian: Manage vaults -> Open folder as vault.');
