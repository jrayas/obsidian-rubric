#!/usr/bin/env python3
"""Runs the vault validator (tools/validate.py) against the per-domain override fixture.

  python3 tests/validator/run_validator_tests.py [path/to/validate.py]

The validator lives in the vault, not in this repository; give its path as an argument or in VALIDATE_PY.
Every case works on a throw-away copy of tests/fixtures/domain-vault, so nothing is written to the fixture or the vault.
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
FIX = HERE.parent / 'fixtures' / 'domain-vault'
DEFAULT = pathlib.Path.home() / 'Vault' / 'Second Brain The Knowledge' / 'tools' / 'validate.py'
VALIDATOR = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('VALIDATE_PY', DEFAULT))
TMP = pathlib.Path(tempfile.mkdtemp(prefix='domain-fixture-'))
FAILS, PASSES = [], 0


def fresh(name, with_invalid=False):
    """A new copy of the fixture, optionally with the invalid notes added to the vault."""
    root = TMP / name
    shutil.copytree(FIX, root, ignore=shutil.ignore_patterns('invalid-notes'))
    if with_invalid:
        shutil.copytree(FIX / 'invalid-notes', root, dirs_exist_ok=True)
    return root


def edit(root, changes):
    """changes: {relative path under _schema: new text | callable(old text) | None to delete}"""
    for rel, how in changes.items():
        p = root / '_schema' / rel
        if how is None:
            p.unlink()
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(how(p.read_text()) if callable(how) else how)


def run(root, *args):
    r = subprocess.run([sys.executable, str(VALIDATOR), '--root', str(root), '--all', *args], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def check(label, ok, detail=''):
    global PASSES
    if ok:
        PASSES += 1
        print('  pass  ' + label)
    else:
        FAILS.append(label)
        print('  FAIL  %s%s' % (label, ('\n        ' + detail.replace('\n', '\n        ')) if detail else ''))


def errors(out):
    return [l[6:] for l in out.splitlines() if l.startswith('ERROR ')]


# ------------------------------------------------------------------------------------------------ the valid fixture
print('valid notes')
code, out = run(fresh('valid'))
check('every valid note passes: exit 0 and no errors', code == 0 and not errors(out), out)
check('the summary line says 0 errors', '0 errors' in out)

# ------------------------------------------------------------------------------------------------ one invalid note per rule
print('invalid notes: each fails with its own rule, and nothing else fails')
NOTE_RULES = {
    'Bad section prefix': 'section prefix',                                  # section not matching the note's domain
    'Bad track prefix': 'track prefix',                                      # track not matching the note's domain
    'Wrong folder': 'must sit directly in Knowledge/<domain>/',              # note folder not matching domain
    'Removed property': 'property standards is removed for domain demo',     # removed property present
    'Bad kind': "kind='concept' not allowed",                                # a default value the domain replaced
    'Unknown section': 'unknown section',                                    # not in the default list nor the domain's
    'Domain tag in pcb': "tags term 'theorem' not preferred",                # another domain's tag
    'Added property outside its domain': 'property question_kind not in schema',
    'Bad added value': "question_kind='essay' not allowed",
    'Missing unique id': 'missing unique_id (domain demo)',
    'Unique id wrong domain': 'does not match type kb and domain demo (KB-DM)',
    'Unique id wrong type': 'does not match type kb and domain demo (KB-DM)',
    'Malformed unique id': 'unique_id pattern',
    'Unique id duplicate': 'duplicate unique_id KB-DM-2026-0001',
}
code, out = run(fresh('invalid-notes', True))
errs = errors(out)
check('the run fails', code == 1)
for stem, expect in NOTE_RULES.items():
    mine = [e for e in errs if e.split(':')[0].endswith('/' + stem + '.md')]
    check('%-36s -> %s' % (stem, expect), any(expect in e for e in mine), '\n'.join(mine) or 'no error for this note')
stems = {s + '.md' for s in NOTE_RULES}
stray = [e for e in errs if not any(e.split(':')[0].endswith('/' + s) for s in stems)]
check('no error on any other note (the valid ones still pass)', not stray, '\n'.join(stray))

# ------------------------------------------------------------------------------------------------ one broken schema file per rule
print('schema rules: each broken override file is reported')
KB = 'types/kb/demo.yaml'
CASES = [
    ('core property removed (status)', {KB: 'domain: demo\nremove: [status]\n'}, 'core property'),
    ('core property removed (section, in a module file)', {'modules/curriculum/demo.yaml': 'domain: demo\nremove: [section]\n'}, 'core property'),
    ('override changes a type', {KB: 'domain: demo\noverride:\n  kind:\n    type: string\n'}, 'may not change the type'),
    ('unknown key inside an override', {KB: 'domain: demo\noverride:\n  kind:\n    colour: red\n'}, 'unknown override key kind.colour'),
    ('unknown key at the top of a file', {KB: 'domain: demo\nextras: [a]\n'}, 'unknown override key extras'),
    ('vocabulary term equals a default term', {'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  routing: {}\n'}, 'the default wins'),
    ('vocabulary term equals a default synonym', {'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  routes: {}\n'}, 'the default wins'),
    ('vocabulary synonym equals a default term', {'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  paths:\n    synonyms: [routing]\n'}, 'the default wins'),
    ('track term without the domain prefix', {'vocabularies/tracks/demo.yaml': 'domain: demo\nterms:\n  other-path: {}\n'}, 'must start with demo-'),
    ('section without the domain prefix', {'modules/curriculum/demo.yaml': 'domain: demo\nsections: [pcb-extra]\n'}, 'must start with demo-'),
    ('overridden section values without the prefix', {'modules/curriculum/demo.yaml': 'domain: demo\noverride:\n  section:\n    values: [pcb-core]\n'}, 'must start with demo-'),
    ('section already in the default list', {'modules/curriculum/demo.yaml': 'domain: demo\nsections: [demo-basics]\n', 'modules/curriculum.yaml': lambda t: t.replace('[pcb-start-here, pcb-core]', '[pcb-start-here, pcb-core, demo-basics]')}, 'already in the default list'),
    ('default that is not among the values or the file\'s sections', {'modules/curriculum/demo.yaml': 'domain: demo\nsections: [demo-basics]\noverride:\n  section:\n    default: demo-elsewhere\n'}, 'is not one of its values'),
    ('override file for a domain that is not a domain value', {'types/kb/ghost.yaml': 'domain: ghost\nremove: [standards]\n'}, 'is not one of the domains'),
    ('override file for an unknown domain, vocabulary', {'vocabularies/tags/ghost.yaml': 'domain: ghost\nterms: {}\n'}, 'is not one of the domains'),
    ('file says another domain', {KB: 'domain: pcb\nremove: [standards]\n'}, 'says pcb'),
    ('file says no domain', {KB: 'remove: [standards]\n'}, 'missing "domain: demo"'),
    ('override of a property the type lacks', {KB: 'domain: demo\noverride:\n  nope:\n    default: x\n'}, 'cannot override nope'),
    ('remove of a property the type lacks', {KB: 'domain: demo\nremove: [nope]\n'}, 'cannot remove nope'),
    ('add of a property the type has', {KB: 'domain: demo\nadd:\n  kind: {type: string}\n'}, 'cannot add kind'),
    ('values on a property that is not an enum', {KB: 'domain: demo\noverride:\n  order:\n    values: [a]\n'}, 'not an enum'),
    ('default that is not one of the values', {KB: 'domain: demo\noverride:\n  kind:\n    default: concept\n    values: [definition]\n'}, 'is not one of its values'),
    ('one property under two verbs', {KB: 'domain: demo\noverride:\n  kind:\n    default: proof\nremove: [kind]\n'}, 'one verb per property'),
    ('module file touches another module\'s property', {'modules/verification/demo.yaml': 'domain: demo\noverride:\n  kind:\n    default: x\n'}, 'has no such property'),
    ('sections in a module without a section property', {'modules/verification/demo.yaml': 'domain: demo\nsections: [demo-x]\n'}, 'section property'),
    ('same property removed twice (module and type file)', {'modules/verification/demo.yaml': 'domain: demo\nremove: [standards]\n'}, 'cannot remove standards'),
    ('added property clashes with another type\'s property of that name', {'types/exercise/demo.yaml': 'domain: demo\nadd:\n  kind: {type: integer}\n'}, 'different value types'),
    ('added list of terms with an unknown vocabulary', {KB: 'domain: demo\nadd:\n  labels: {type: list, items: term, vocabulary: nothing}\n'}, 'needs a known vocabulary'),
    ('add without a type', {KB: 'domain: demo\nadd:\n  thing: {description: x}\n'}, 'needs a type'),
    ('domain prefix that is not two capital letters', {'registry/domains.yaml': lambda t: t.replace('prefix: DM', 'prefix: Dem')}, 'must be two capital letters'),
    ('two domains with the same prefix', {'registry/domains.yaml': lambda t: t.replace('prefix: DM', 'prefix: PC')}, 'both use the prefix PC'),
    ('default domain that is not listed', {'registry/domains.yaml': lambda t: t.replace('default: pcb', 'default: nowhere')}, 'default must be one of the listed domains'),
    ('domain name that is not a slug', {'registry/domains.yaml': lambda t: t.replace('  demo:', '  Demo:')}, 'must be lowercase letters'),
    ('two domains with the same folder', {'registry/domains.yaml': lambda t: t.replace('prefix: DM', 'prefix: DM, folder: PCB')}, 'both use the folder'),
    ('no prefix on any domain, but a unique_id property', {'registry/domains.yaml': lambda t: t.replace(' prefix: PC ', ' ').replace(' prefix: DM ', ' ')}, 'needs prefixes'),
    ('a unique_id in a domain that has no prefix', {'registry/domains.yaml': lambda t: t.replace('{ prefix: DM }', '{}')}, 'unique_id present but domain demo has no prefix'),
    ('a folder name that differs from the domain: the notes no longer sit in it', {'registry/domains.yaml': lambda t: t.replace('{ prefix: DM }', '{ prefix: DM, folder: Demonstration }')}, 'must sit directly in Knowledge/<domain>/'),
    ('the registry is missing, but the domain property reads from it', {'registry/domains.yaml': None}, 'which does not exist'),
    ('registry lists no domains', {'registry/domains.yaml': 'default: pcb\ndomains: {}\n'}, 'needs a domains map'),
    ('prefixes on the property as well as the registry', {'modules/domain.yaml': lambda t: t.replace('    values_from: domains\n', '    values_from: domains\n    prefixes: {pcb: PC}\n')}, 'prefixes belong there'),
    ('a type uses curriculum without the domain module it requires', {'types/kb.yaml': lambda t: t.replace('findability, domain, curriculum', 'findability, curriculum')}, 'requires domain: add it to uses'),
    ('a module requires a module that is not in the registry', {'modules/curriculum.yaml': lambda t: t.replace('requires: [domain]', 'requires: [domain, ghost]')}, 'requires ghost, which is not in the registry'),
    ('a module that lost its content', {'modules/domain.yaml': 'domain: demo\nsections: [demo-a]\n'}, 'has no properties'),
    ('override file that does not parse', {KB: 'domain: demo\nremove: [a\n'}, 'does not parse'),
]
for label, changes, expect in CASES:
    root = fresh('case')
    shutil.rmtree(root)
    root = fresh('case')
    edit(root, changes)
    code, out = run(root)
    check('%-62s -> %s' % (label, expect), code == 1 and any(expect in e for e in errors(out)), out)
    shutil.rmtree(root)

root = fresh('sections-default')
edit(root, {'modules/curriculum/demo.yaml': 'domain: demo\nsections: [demo-basics, demo-proofs]\noverride:\n  section:\n    default: demo-proofs\n'})
code, out = run(root)
check('a default that is one of the same file\'s sections is accepted', code == 0 and not errors(out), out)

# ------------------------------------------------------------------------------------------------ append-only against git HEAD
print('append-only against git HEAD: what a type exposes may grow, never shrink or change')


def git_fresh(name):
    """A committed copy of the valid fixture, so changes are compared with HEAD."""
    root = fresh(name)
    def g(*a): subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=root, capture_output=True, text=True, check=True)
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'baseline')
    return root


def append_case(label, changes, expect, ok=False):
    root = git_fresh('git')
    edit(root, changes)
    code, out = run(root)
    errs = errors(out)
    if ok:
        bad = [e for e in errs if 'removed' in e or 'changed from' in e or 'new attribute' in e or 'changed to' in e]
        check(label, not bad, '\n'.join(bad) or out)
    else:
        check('%-60s -> %s' % (label, expect), code == 1 and any(expect in e for e in errs), out)
    shutil.rmtree(root)


append_case('a property removed from a module', {'modules/curriculum.yaml': lambda t: t.replace('  level:\n    type: enum\n    required: true\n    values: [beginner, intermediate, advanced]\n', '')}, 'property level removed')
append_case('an enum value removed', {'types/kb.yaml': lambda t: t.replace('values: [concept, how-to, reference]', 'values: [concept, how-to]')}, 'values removed or changed')
append_case('an enum value renamed', {'types/kb.yaml': lambda t: t.replace('how-to, reference]', 'howto, reference]')}, 'values removed or changed')
append_case('a default changed', {'types/kb.yaml': lambda t: t.replace('default: concept', 'default: reference')}, 'default changed from')
append_case('a property made required', {'modules/verification.yaml': lambda t: t.replace('  standards:\n    type: list', '  standards:\n    required: true\n    type: list')}, 'required changed from')
append_case('a type prefix changed', {'registry/types.yaml': lambda t: t.replace('prefix: KB', 'prefix: KX')}, 'prefix changed')
append_case('a type removed from the registry', {'registry/types.yaml': lambda t: t.replace("  exercise: { file: types/exercise.yaml, prefix: EX, version: 1 }\n", '')}, 'type exercise removed')
append_case('a module removed from the registry', {'registry/types.yaml': lambda t: t.replace('  verification: modules/verification.yaml\n', '')}, 'module verification removed')
append_case('a vocabulary term removed (still checked file by file)', {'vocabularies/tags.yaml': lambda t: t.replace('  power: {}\n', '')}, 'power removed')
append_case('min_plugin_version lowered', {'registry/types.yaml': lambda t: t.replace('min_plugin_version: 0.1.0', 'min_plugin_version: 0.0.1')}, 'min_plugin_version lowered') if False else None

# allowed: growth and restructuring
append_case('a new optional property is allowed', {'types/kb.yaml': lambda t: t + '  note_to_self:\n    type: string\n'}, '', ok=True)
append_case('a new enum value is allowed', {'types/kb.yaml': lambda t: t.replace('values: [concept, how-to, reference]', 'values: [concept, how-to, reference, glossary]')}, '', ok=True)
append_case('a new type is allowed', {'registry/types.yaml': lambda t: t + "  extra:    { file: types/extra.yaml,    prefix: XT, version: 1 }\n", 'types/extra.yaml': 'type: extra\nuses: [base, findability]\noverrides:\n  status:\n    values: [draft]\n    default: draft\nproperties: {}\n'}, '', ok=True)
move = {
    'modules/verification.yaml': lambda t: t.replace('  standards:\n    type: list\n    items: string\n', ''),
    'modules/extra.yaml': 'module: extra\nproperties:\n  standards:\n    type: list\n    items: string\n',
    'registry/types.yaml': lambda t: t.replace('  verification: modules/verification.yaml\n', '  verification: modules/verification.yaml\n  extra: modules/extra.yaml\n'),
    'types/kb.yaml': lambda t: t.replace('curriculum, verification]', 'curriculum, verification, extra]'),
    'types/exercise.yaml': lambda t: t.replace('curriculum, verification]', 'curriculum, verification, extra]'),
}
append_case('a property moved to another module is allowed (it is still exposed, unchanged)', move, '', ok=True)

# ------------------------------------------------------------------------------------------------ backwards compatibility
print('no override folders: nothing changes')
root = fresh('plain')
for d in ['types/kb', 'types/exercise', 'modules/curriculum', 'vocabularies/tags', 'vocabularies/tracks']:
    shutil.rmtree(root / '_schema' / d)
for n in ['Knowledge/demo', 'Exercises/demo']:
    shutil.rmtree(root / n)
code, out = run(root)
check('a vault with only the default schema and pcb notes passes', code == 0 and not errors(out), out)
check('its output has no domain lines and no warnings', 'warning' not in out and 'domain' not in out.replace('0 errors', ''))

# ------------------------------------------------------------------------------------------------ warnings and the domain command
print('warnings and the --domain command')
root = fresh('extras')
code, out = run(root)
check('tag warnings are off by default', 'warning:' not in out)
code, out = run(root, '--warnings')
check('with --warnings: a tag used on one note is listed', 'warning: tag theorem is used on only 1 note (Triangle inequality)' in out, out)
check('with --warnings: a tag used on two notes is listed', re.search(r'warning: tag lemma is used on only 2 notes', out) is not None, out)
check('warnings do not change the result', code == 0)
code, out = run(root, '--domain', 'demo')
for expect in ['domain: demo', 'types/kb/demo.yaml', 'override kind: values', 'add prerequisite_theorems', 'remove standards', 'sections: demo-basics, demo-proofs',
               'modules/curriculum/demo.yaml', 'vocabularies/tags/demo.yaml', 'removed: standards', 'added: prerequisite_theorems', 'vocabulary tags: default 3 terms + 2']:
    check('--domain demo prints "%s"' % expect, expect in out, out)
check('--domain demo: kb lists its effective properties in note order', '  kb: type, schema, id, name, status, aliases, description, tags, domain, unique_id, section, level, order, track, ai_generated, generated_by, verified, kind, prerequisite_theorems, created, modified' in out, out)
check('--domain demo: exercise gets question_kind and keeps standards', 'difficulty, question_kind, created, modified' in out and 'standards' in out.split('  exercise:')[1].split('\n')[0], out)
check('--domain demo exits 0', code == 0)
code, out = run(root, '--domain', 'pcb')
check('--domain pcb (a domain without overrides) says the default applies', 'none: the default schema applies' in out and code == 0, out)
code, out = run(root, '--domain', 'nosuch')
check('--domain nosuch is refused', code == 2 and 'unknown domain nosuch' in out, out)

shutil.rmtree(TMP, ignore_errors=True)
print('\n%d passed, %d failed' % (PASSES, len(FAILS)))
for f in FAILS:
    print('  FAILED: ' + f)
sys.exit(1 if FAILS else 0)
