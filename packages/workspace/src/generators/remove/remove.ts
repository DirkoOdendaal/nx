import {
  convertNxGenerator,
  createProjectGraphAsync,
  formatFiles,
  ProjectGraph,
  readProjectConfiguration,
  Tree,
} from '@nrwl/devkit';

import { checkDependencies } from './lib/check-dependencies';
import { checkTargets } from './lib/check-targets';
import { removeProject } from './lib/remove-project';
import { updateTsconfig } from './lib/update-tsconfig';
import { removeProjectConfig } from './lib/remove-project-config';
import { Schema } from './schema';
import { updateJestConfig } from './lib/update-jest-config';

export async function removeGenerator(tree: Tree, schema: Schema) {
  const project = readProjectConfiguration(tree, schema.projectName);
  await checkDependencies(tree, schema);
  await checkTargets(tree, schema);
  updateJestConfig(tree, schema, project);
  removeProjectConfig(tree, schema);
  removeProject(tree, project);
  await updateTsconfig(tree, schema);
  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default removeGenerator;

export const removeSchematic = convertNxGenerator(removeGenerator);
