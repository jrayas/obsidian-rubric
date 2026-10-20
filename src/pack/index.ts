// The starter schema pack, embedded as text so a release needs only main.js, manifest.json and styles.css.
import typesReg from '../../schema-pack/registry/types.yaml';
import foldersReg from '../../schema-pack/registry/folders.yaml';
import scopeReg from '../../schema-pack/registry/scope.yaml';
import base from '../../schema-pack/modules/base.yaml';
import findability from '../../schema-pack/modules/findability.yaml';
import taxonomy from '../../schema-pack/modules/taxonomy.yaml';
import relations from '../../schema-pack/modules/relations.yaml';
import provenance from '../../schema-pack/modules/provenance.yaml';
import review from '../../schema-pack/modules/review.yaml';
import tags from '../../schema-pack/vocabularies/tags.yaml';
import note from '../../schema-pack/types/note.yaml';
import kb from '../../schema-pack/types/kb.yaml';
import project from '../../schema-pack/types/project.yaml';
import exercise from '../../schema-pack/types/exercise.yaml';
import journal from '../../schema-pack/types/journal.yaml';
import person from '../../schema-pack/types/person.yaml';
import resource from '../../schema-pack/types/resource.yaml';
import task from '../../schema-pack/types/task.yaml';
import reference from '../../schema-pack/REFERENCE.md';

/** Path inside the schema folder -> file text. */
export const STARTER_PACK: Readonly<Record<string, string>> = {
  'registry/types.yaml': typesReg,
  'registry/folders.yaml': foldersReg,
  'registry/scope.yaml': scopeReg,
  'modules/base.yaml': base,
  'modules/findability.yaml': findability,
  'modules/taxonomy.yaml': taxonomy,
  'modules/relations.yaml': relations,
  'modules/provenance.yaml': provenance,
  'modules/review.yaml': review,
  'vocabularies/tags.yaml': tags,
  'types/note.yaml': note,
  'types/kb.yaml': kb,
  'types/project.yaml': project,
  'types/exercise.yaml': exercise,
  'types/journal.yaml': journal,
  'types/person.yaml': person,
  'types/resource.yaml': resource,
  'types/task.yaml': task,
  'REFERENCE.md': reference,
};
