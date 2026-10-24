/**
 * The vault check (spec "Vault check", the eleven checks). Pure: it reads note text and returns findings.
 * Each finding can carry fixes; a fix has a preview (`diff`) computed by running the very same change on the
 * text it was prepared from, so what is shown is what is written. Nothing here changes anything.
 */
import { defaultValue } from './convert';
import { domainOf, domainViolations, vocabFor } from './domain-overrides';
import { desiredOrder, editFrontmatter, readFrontmatter } from './frontmatter';
import type { Frontmatter } from './frontmatter';
import { convertOldId, parseId, parseOldId, planRenumbering, nextId, yearOf } from './ids';
import { matchNote } from './matcher';
import { domainRepeatsBreadcrumb, isNewerThanSchema, needsMigration, newerSchemaMessage, planMigration } from './migrate';
import { describeChanges } from './preview';
import { caseCollisions } from './fs-names';
import { checkTags } from './tags';
import { formatLocal } from './timestamps';
import { firstSegment } from './normalise';
import type { Problem, ResolvedType, SchemaPack, Vocabulary } from './schema-types';
import { UNIQUE_ID, applyUniqueId, nextUniqueId, parseUniqueId, planUniqueId, planUniqueRenumbering, uniqueScope } from './unique-id';
import type { AllocateUnique } from './unique-id';
import { isDatetimeText, isEmpty, validateValue } from './validate';

export type FixKind = 'frontmatter' | 'text' | 'vocabulary' | 'index';

export interface Fix {
  label: string;
  kind: FixKind;
  /** What the preview shows. For a frontmatter fix it is computed from a dry run of `mutate`. */
  diff: string[];
  mutate?: (fm: Frontmatter) => void;
  transform?: (text: string) => string;
  forceOrder?: boolean;
  /** `domain` set: the term goes into that domain's vocabulary file when it has one, else the default. */
  vocabulary?: { name: string; term: string; domain?: string };
  /** IDs this fix gives up (renumbering). They are never handed out again. */
  retire?: string[];
  /** For kind 'index': the entry to accept as the new known value. */
  accept?: { id?: string; created?: string };
}

export interface Finding {
  path: string;
  basename: string;
  /** Which of the eleven checks (1 to 11). */
  check: number;
  code: string;
  severity: 'problem' | 'warning';
  message: string;
  fixes: Fix[];
  /** The file text the fixes were prepared from. Applying checks the file still equals it. */
  baseText: string;
}

export interface GlobalFinding {
  check: 10 | 11;
  severity: 'problem' | 'warning';
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface NoteInput {
  path: string;
  basename: string;
  text: string;
  /** File creation time in ms. */
  ctime: number;
  type: ResolvedType;
}

export interface KnownEntry {
  id?: string;
  created?: string;
}

export interface CheckContext {
  pack: SchemaPack;
  now: Date;
  /** IDs already in use anywhere in the vault. */
  usedIds: Iterable<string>;
  /** Every `unique_id` in the vault (for the domain-level IDs). Optional: absent means none. */
  usedUniqueIds?: Iterable<string>;
  retiredIds: Iterable<string>;
  /** First-seen ID and `created` per note path (the small local index, check 9). */
  known: Record<string, KnownEntry>;
}

export interface VaultReport {
  scanned: number;
  findings: Finding[];
  globalFindings: GlobalFinding[];
  /** Notes that have at least one finding. */
  notesWithFindings: number;
}

function orderOptions(type: ResolvedType, forceOrder: boolean) {
  return { order: (keys: string[]) => desiredOrder(keys, type), forceOrder };
}

/** Preview of a frontmatter change: the lines `describeChanges` gives for a dry run on the base text. */
export function previewFrontmatter(text: string, type: ResolvedType, mutate: (fm: Frontmatter) => void, forceOrder: boolean): string[] {
  const dry = editFrontmatter(text, mutate, orderOptions(type, forceOrder));
  const lines = describeChanges(dry.changes);
  if (dry.changed && lines.length === 0) lines.push('(property order)');
  return lines;
}

/** The fix applied to its base text, exactly as it will be written. */
export function applyFixToText(base: string, type: ResolvedType, fix: Fix): string {
  if (fix.kind === 'text' && fix.transform) return fix.transform(base);
  if (fix.kind === 'frontmatter' && fix.mutate) return editFrontmatter(base, fix.mutate, orderOptions(type, fix.forceOrder === true)).text;
  return base;
}

function fmFix(label: string, base: string, type: ResolvedType, mutate: (fm: Frontmatter) => void, extra: Partial<Fix> = {}): Fix {
  const forceOrder = extra.forceOrder === true;
  return { label, kind: 'frontmatter', diff: previewFrontmatter(base, type, mutate, forceOrder), mutate, ...extra };
}

/** Tags written in the body (`#idea`), outside code. */
export function bodyTags(text: string): string[] {
  const m = /^\ufeff?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  const body = (m ? text.slice(m[0].length) : text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const out: string[] = [];
  for (const hit of body.matchAll(/#(\p{L}[\p{L}\p{N}_\-/]*)/gu)) {
    const before = hit.index > 0 ? body.charAt(hit.index - 1) : '';
    if (/[\p{L}\p{N}_#&/]/u.test(before)) continue;
    const tag = hit[1] as string;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

function replaceBodyTag(text: string, from: string, to: string): string {
  const m = /^\ufeff?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  const head = m ? m[0] : '';
  const body = text.slice(head.length);
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`#${escaped}(?![\\p{L}\\p{N}_\\-/])`, 'gu');
  let out = '';
  let last = 0;
  for (const hit of body.matchAll(re)) {
    const before = hit.index > 0 ? body.charAt(hit.index - 1) : '';
    if (/[\p{L}\p{N}_#&/]/u.test(before)) continue;
    out += body.slice(last, hit.index) + `#${to}`;
    last = hit.index + hit[0].length;
  }
  return head + out + body.slice(last);
}

/** Allocates IDs during one scan without touching the vault, remembering what it handed out. */
export function makeAllocator(used: Iterable<string>, retired: Iterable<string>) {
  const taken = new Set(used);
  const gone = [...retired];
  return (prefix: string, year: number): string => {
    const id = nextId(prefix, year, taken, gone);
    taken.add(id);
    return id;
  };
}

/** Allocates unique IDs during one scan, like `makeAllocator`. */
export function makeUniqueAllocator(used: Iterable<string>, retired: Iterable<string>): AllocateUnique {
  const taken = new Set(used);
  const gone = [...retired];
  return (typePrefix, domainPrefix, year) => {
    const id = nextUniqueId(typePrefix, domainPrefix, year, taken, gone);
    taken.add(id);
    return id;
  };
}

/** All findings for one note (checks 1 to 9; duplicates are found across notes by `checkDuplicates`). */
export function checkNote(ctx: CheckContext, note: NoteInput, allocate: (prefix: string, year: number) => string, allocateUnique?: AllocateUnique): Finding[] {
  const { type } = note;
  const out: Finding[] = [];
  const add = (check: number, code: string, severity: Finding['severity'], message: string, fixes: Fix[] = []) =>
    out.push({ path: note.path, basename: note.basename, check, code, severity, message, fixes, baseText: note.text });

  let fm: Frontmatter;
  try {
    fm = readFrontmatter(note.text) ?? {};
  } catch (e) {
    add(2, 'invalid-yaml', 'problem', `The properties are not valid YAML: ${e instanceof Error ? e.message : String(e)}. Nothing can be checked until that is fixed.`);
    return out;
  }
  const has = (k: string) => !isEmpty(fm[k]);

  // 1. required properties missing ------------------------------------------------------------------------
  if (!has('id')) {
    const created = typeof fm.created === 'string' ? fm.created : formatLocal(new Date(note.ctime));
    const id = allocate(type.prefix, yearOf(created) ?? ctx.now.getFullYear());
    add(1, 'missing-id', 'problem', `no ID. It will get ${id}.`, [fmFix('Assign ID', note.text, type, (d) => void (d.id = id))]);
  }
  if (!has('created')) {
    const estimate = formatLocal(new Date(note.ctime));
    add(1, 'missing-created', 'problem', `created is missing (estimated from the file’s creation time: ${estimate}).`, [
      fmFix('Fill created', note.text, type, (d) => void (d.created = estimate)),
    ]);
  }
  const missing = type.properties.filter((p) => p.required && !has(p.name) && p.name !== 'id' && p.name !== 'created');
  if (missing.length > 0) {
    const values: Record<string, unknown> = {};
    for (const p of missing) {
      switch (p.name) {
        case 'type':
          values.type = type.name;
          break;
        case 'schema':
          values.schema = type.version;
          break;
        case 'name':
          values.name = note.basename;
          break;
        case 'modified':
          values.modified = typeof fm.created === 'string' ? fm.created : formatLocal(ctx.now);
          break;
        default: {
          const v = defaultValue(p, ctx.now);
          if (v !== undefined) values[p.name] = v;
        }
      }
    }
    const fixable = Object.keys(values).length > 0;
    add(1, 'missing-required', 'problem', `missing required: ${missing.map((p) => p.name).join(', ')}.`, fixable ? [
      fmFix('Add missing properties', note.text, type, (d) => {
        for (const [k, v] of Object.entries(values)) d[k] = v;
      }),
    ] : []);
  }

  // 2. values outside their rules -----------------------------------------------------------------------------
  for (const def of type.properties) {
    if (!(def.name in fm) || isEmpty(fm[def.name])) continue;
    if (def.name === 'id' || def.name === 'breadcrumb') continue; // checks 3 and 6
    if (def.type === 'list' && def.items === 'term') continue; // check 4
    const issue = validateValue(def, fm[def.name]);
    if (!issue) continue;
    const fixes =
      def.type === 'enum' && def.values
        ? def.values.map((v) => fmFix(v, note.text, type, (d) => void (d[def.name] = v)))
        : [];
    add(2, `value-${issue.code}`, 'problem', issue.message, fixes);
  }
  // The note's domain: `section` and `track` start with it, and properties the domain removed are not present.
  // Reported only: the plugin never deletes a value, and which prefix is right is the author's call.
  const baseType = ctx.pack.types.get(type.name);
  if (baseType) for (const v of domainViolations(baseType, type, fm)) add(2, v.code, 'problem', v.message);

  // 3. IDs --------------------------------------------------------------------------------------------------------
  if (has('id')) {
    const id = fm.id;
    if (typeof id === 'string' && parseOldId(id)) {
      const converted = convertOldId(id, typeof fm.created === 'string' ? fm.created : undefined);
      add(3, 'old-id', 'problem', converted ? `old-style ID ${id} becomes ${converted} (year from created, number kept).` : `old-style ID ${id}, and no created to take the year from.`, converted
        ? [fmFix('Convert ID', note.text, type, (d) => void (d.id = converted))]
        : []);
    } else if (!parseId(id)) {
      add(3, 'malformed-id', 'problem', `ID “${typeof id === 'string' ? id : JSON.stringify(id)}” is not PREFIX-YYYY-NNNN. IDs are never changed automatically.`);
    } else {
      const p = parseId(id);
      const year = yearOf(fm.created);
      if (p && year !== null && p.year !== year) add(3, 'id-year', 'warning', `the ID year ${p.year} differs from the year in created (${year}). It is left as it is.`);
    }
  }

  // 3 (continued). the unique ID, TYPE-DOMAIN-YEAR-NNNN, which names the note's type and domain --------------------
  if (allocateUnique && uniqueScope(type, fm.domain)) {
    const scope = uniqueScope(type, fm.domain);
    const year = yearOf(fm.created) ?? ctx.now.getFullYear();
    if (scope && !has(UNIQUE_ID)) {
      const change = planUniqueId(fm, type, allocateUnique, year);
      if (change) add(3, 'missing-unique-id', 'problem', `no unique ID. It will get ${change.to}.`, [fmFix('Assign unique ID', note.text, type, (d) => applyUniqueId(d, change, type, ctx.now))]);
    } else if (scope && !parseUniqueId(fm[UNIQUE_ID])) {
      add(3, 'malformed-unique-id', 'problem', `unique ID “${typeof fm[UNIQUE_ID] === 'string' ? fm[UNIQUE_ID] : JSON.stringify(fm[UNIQUE_ID])}” is not TYPE-DOMAIN-YEAR-NNNN. It is never changed automatically.`);
    } else if (scope) {
      const parsed = parseUniqueId(fm[UNIQUE_ID]);
      if (parsed && (parsed.typePrefix !== scope.typePrefix || parsed.domainPrefix !== scope.domainPrefix)) {
        const change = planUniqueId(fm, type, allocateUnique, year);
        if (change) {
          add(
            3,
            'unique-id-mismatch',
            'problem',
            `unique ID ${String(fm[UNIQUE_ID])} names ${parsed.typePrefix}-${parsed.domainPrefix}, but this note is ${scope.typePrefix}-${scope.domainPrefix} (domain ${scope.domain}). It will get ${change.to}; the old one is kept in archived_fields.`,
            [fmFix('Issue unique ID again', note.text, type, (d) => applyUniqueId(d, change, type, ctx.now), { retire: [String(fm[UNIQUE_ID])] })],
          );
        }
      }
    }
  }

  // 4. tags -------------------------------------------------------------------------------------------------------
  for (const def of type.properties) {
    if (def.type !== 'list' || def.items !== 'term' || !def.vocabulary) continue;
    const vocab: Vocabulary | undefined = vocabFor(ctx.pack, def.vocabulary, domainOf(fm));
    if (!vocab) continue;
    if (def.name in fm) {
      const issues = checkTags(fm[def.name], vocab);
      if (def.normalise && issues.replacements.length > 0) {
        add(4, 'tag-synonym', 'problem', `${issues.replacements.map((r) => `“${r.from}” is a synonym of “${r.to}”`).join('; ')}.`, [
          fmFix('Replace', note.text, type, (d) => void (d[def.name] = checkTags(d[def.name], vocab).normalised)),
        ]);
      }
      if (def.strict) {
        for (const tag of issues.unknown) {
          add(4, 'tag-unknown', 'problem', `tag “${tag}” is not in the vocabulary.`, [
            { label: 'Add to vocabulary', kind: 'vocabulary', diff: [`+ ${def.vocabulary}: ${tag}`], vocabulary: { name: def.vocabulary, term: tag, ...(domainOf(fm) ? { domain: domainOf(fm) as string } : {}) } },
          ]);
        }
      }
    }
    for (const tag of bodyTags(note.text)) {
      const preferred = vocab.lookup.get(tag.toLowerCase());
      if (preferred === tag) continue;
      if (preferred !== undefined) {
        add(4, 'body-tag-synonym', 'warning', `body tag #${tag} is a synonym of #${preferred}.`, [
          { label: 'Replace in the note', kind: 'text', diff: [`#${tag} → #${preferred}`], transform: (t) => replaceBodyTag(t, tag, preferred) },
        ]);
      } else {
        add(4, 'body-tag-unknown', 'warning', `body tag #${tag} is not in the vocabulary (reported only).`);
      }
    }
    break; // one controlled tag property per type
  }

  // 5. name -------------------------------------------------------------------------------------------------------
  if (has('name') && fm.name !== note.basename) {
    add(5, 'name-mismatch', 'warning', `name “${typeof fm.name === 'string' ? fm.name : JSON.stringify(fm.name)}” does not match the file name “${note.basename}”.`, [
      fmFix('Set name to the file name', note.text, type, (d) => void (d.name = note.basename)),
    ]);
  }

  // 6. breadcrumb -----------------------------------------------------------------------------------------------
  if (type.byName.has('breadcrumb')) {
    const crumb = fm.breadcrumb;
    if (isEmpty(crumb)) {
      add(6, 'no-breadcrumb', 'warning', 'no breadcrumb. The breadcrumb plugin writes it; a folder name is used for matching meanwhile.');
    } else if (typeof crumb !== 'string' || validateValue(type.byName.get('breadcrumb') as NonNullable<ReturnType<typeof type.byName.get>>, crumb)) {
      add(6, 'odd-breadcrumb', 'warning', `breadcrumb “${typeof crumb === 'string' ? crumb : JSON.stringify(crumb)}” is not a folder path starting with the root folder.`);
    } else {
      const hit = matchNote(ctx.pack, { path: 'x.md', frontmatter: { breadcrumb: crumb } }, { mode: 'auto', noMatch: 'unmanaged' });
      if (hit.kind !== 'matched' && hit.kind !== 'conflict') {
        add(6, 'breadcrumb-unmapped', 'warning', `the first segment of the breadcrumb (“${firstSegment(crumb)}”) maps to no schema.`);
      }
    }
  }

  // 7. older schema version -----------------------------------------------------------------------------------
  if (needsMigration(fm, type)) {
    const plan = planMigration(fm, type, ctx.now);
    add(7, 'old-schema', 'problem', `schema ${plan.from} → ${plan.to}`, [
      fmFix('Apply migration', note.text, type, plan.apply, { forceOrder: true }),
    ]);
  }

  if (isNewerThanSchema(fm, type)) {
    add(7, 'newer-schema', 'warning', `${newerSchemaMessage(fm, type)} No fix is offered.`);
  }

  // 8. leftover domain ------------------------------------------------------------------------------------------
  // Only when the schema does not define the property: a schema with a real `domain` property keeps it.
  for (const key of ['domain', 'domain_path'] as const) {
    if (fm[key] === undefined || type.byName.has(key)) continue;
    const repeats = domainRepeatsBreadcrumb(fm, key);
    add(8, 'leftover-domain', 'warning', repeats ? `leftover ${key} repeats the breadcrumb.` : `leftover ${key} (it does not repeat the breadcrumb, so it is kept until a migration archives it).`, repeats
      ? [fmFix(`Remove ${key}`, note.text, type, (d) => void delete d[key])]
      : []);
  }

  // 9. timestamps and changed IDs -------------------------------------------------------------------------
  if (isDatetimeText(fm.created) && isDatetimeText(fm.modified) && fm.created > fm.modified) {
    add(9, 'created-after-modified', 'warning', `created (${fm.created}) is later than modified (${fm.modified}).`);
  }
  const known = ctx.known[note.path];
  if (known) {
    if (known.id !== undefined && typeof fm.id === 'string' && fm.id !== known.id) {
      const was = known.id;
      add(9, 'id-changed', 'problem', `the ID looks changed outside the plugin (was ${was}, now ${fm.id}). Locks are advisory.`, [
        fmFix(`Restore ${was}`, note.text, type, (d) => void (d.id = was)),
        { label: 'Accept the new ID', kind: 'index', diff: [`known ID: ${was} → ${fm.id}`], accept: { id: fm.id } },
      ]);
    }
    if (known.created !== undefined && typeof fm.created === 'string' && fm.created !== known.created) {
      const was = known.created;
      add(9, 'created-changed', 'problem', `created looks changed outside the plugin (was ${was}, now ${fm.created}).`, [
        fmFix(`Restore ${was}`, note.text, type, (d) => void (d.created = was)),
        { label: 'Accept the new value', kind: 'index', diff: [`known created: ${was} → ${fm.created}`], accept: { created: fm.created } },
      ]);
    }
  }
  return out;
}

/** Check 3: notes sharing an ID. The older note keeps it; the newer one gets the next free number. */
export function checkDuplicates(
  ctx: CheckContext,
  notes: NoteInput[],
  allocated: Iterable<string> = [],
): Finding[] {
  const withId = notes.flatMap((n) => {
    try {
      const fm = readFrontmatter(n.text);
      return typeof fm?.id === 'string' && parseId(fm.id) ? [{ n, id: fm.id, created: typeof fm.created === 'string' ? fm.created : undefined }] : [];
    } catch {
      return [];
    }
  });
  const plan = planRenumbering(withId.map((w) => ({ path: w.n.path, id: w.id, ...(w.created !== undefined ? { created: w.created } : {}), ctime: w.n.ctime })), ctx.retiredIds, allocated);
  const out: Finding[] = [];
  for (const r of plan) {
    const note = notes.find((n) => n.path === r.path) as NoteInput;
    const keeper = withId.find((w) => w.id === r.from && w.n.path !== r.path);
    out.push({
      path: note.path,
      basename: note.basename,
      check: 3,
      code: 'duplicate-id',
      severity: 'problem',
      message: `ID ${r.from} is also used by “${keeper?.n.basename ?? 'an older note'}”, which is older. This note will get ${r.to}.`,
      fixes: [fmFix('Renumber', note.text, note.type, (d) => void (d.id = r.to), { retire: [r.from] })],
      baseText: note.text,
    });
  }
  return out;
}

/** Check 3 across notes: two notes sharing a unique ID. The older keeps it; the newer gets the next free number. */
export function checkUniqueDuplicates(ctx: CheckContext, notes: NoteInput[], allocated: Iterable<string> = []): Finding[] {
  const withId = notes.flatMap((n) => {
    try {
      const fm = readFrontmatter(n.text);
      return typeof fm?.[UNIQUE_ID] === 'string' && parseUniqueId(fm[UNIQUE_ID]) ? [{ n, id: fm[UNIQUE_ID], created: typeof fm.created === 'string' ? fm.created : undefined }] : [];
    } catch {
      return [];
    }
  });
  const plan = planUniqueRenumbering(withId.map((w) => ({ path: w.n.path, id: w.id, ...(w.created !== undefined ? { created: w.created } : {}), ctime: w.n.ctime })), ctx.retiredIds, [...(ctx.usedUniqueIds ?? []), ...allocated]);
  const out: Finding[] = [];
  for (const r of plan) {
    const note = notes.find((n) => n.path === r.path) as NoteInput;
    const keeper = withId.find((w) => w.id === r.from && w.n.path !== r.path);
    out.push({
      path: note.path,
      basename: note.basename,
      check: 3,
      code: 'duplicate-unique-id',
      severity: 'problem',
      message: `unique ID ${r.from} is also used by “${keeper?.n.basename ?? 'an older note'}”, which is older. This note will get ${r.to}.`,
      fixes: [fmFix('Renumber', note.text, note.type, (d) => void (d[UNIQUE_ID] = r.to), { retire: [r.from] })],
      baseText: note.text,
    });
  }
  return out;
}

/** Checks 10 and 11: folders that differ only by case, and problems in the schema files themselves. */
export function checkGlobal(ctx: CheckContext, folderPaths: string[], schemaProblems: Problem[]): GlobalFinding[] {
  const out: GlobalFinding[] = [];
  const byParent = new Map<string, string[]>();
  for (const p of folderPaths) {
    const i = p.lastIndexOf('/');
    const parent = i < 0 ? '' : p.slice(0, i);
    byParent.set(parent, [...(byParent.get(parent) ?? []), i < 0 ? p : p.slice(i + 1)]);
  }
  for (const [parent, names] of byParent) {
    for (const group of caseCollisions(names)) {
      out.push({ check: 10, severity: 'warning', code: 'folder-case', message: `folders ${group.map((g) => `“${parent ? parent + '/' : ''}${g}”`).join(' and ')} differ only by case (they collide on Windows).` });
    }
  }
  for (const p of schemaProblems) {
    out.push({
      check: 11,
      severity: p.severity === 'error' ? 'problem' : 'warning',
      code: p.code,
      message: p.message,
      file: p.file,
      ...(p.line !== undefined ? { line: p.line } : {}),
    });
  }
  for (const c of ctx.pack.folders.conflicts) {
    if (!schemaProblems.some((p) => p.code === 'folder-conflict')) {
      out.push({ check: 11, severity: 'warning', code: 'folder-conflict', message: `folder “${c.folder}” is claimed by several schemas (${c.types.join(', ')}).` });
    }
  }
  return out;
}

/** Run every check over the given notes. Changes nothing. */
export function runVaultCheck(
  ctx: CheckContext,
  notes: NoteInput[],
  extra: { folderPaths: string[]; schemaProblems: Problem[] },
): VaultReport {
  const allocate = makeAllocator(ctx.usedIds, ctx.retiredIds);
  const allocateUnique = makeUniqueAllocator(ctx.usedUniqueIds ?? [], ctx.retiredIds);
  const findings: Finding[] = [];
  const allocated: string[] = [];
  const allocatedUnique: string[] = [];
  for (const n of notes) {
    for (const f of checkNote(
      ctx,
      n,
      (prefix, year) => {
        const id = allocate(prefix, year);
        allocated.push(id);
        return id;
      },
      (typePrefix, domainPrefix, year) => {
        const id = allocateUnique(typePrefix, domainPrefix, year);
        allocatedUnique.push(id);
        return id;
      },
    )) findings.push(f);
  }
  findings.push(...checkDuplicates(ctx, notes, allocated));
  findings.push(...checkUniqueDuplicates(ctx, notes, allocatedUnique));
  const global = checkGlobal(ctx, extra.folderPaths, extra.schemaProblems);
  return { scanned: notes.length, findings, globalFindings: global, notesWithFindings: new Set(findings.map((f) => f.path)).size };
}
