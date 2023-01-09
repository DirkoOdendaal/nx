import {
  convertNxGenerator,
  formatFiles,
  getProjects,
  getWorkspacePath,
  logger,
  normalizePath,
  ProjectConfiguration,
  readProjectConfiguration,
  Tree,
  updateJson,
  writeJson,
} from '@nrwl/devkit';
import { prompt } from 'enquirer';
import { getRelativeProjectJsonSchemaPath } from 'nx/src/generators/utils/project-configuration';
import { dirname } from 'path';
import { Schema } from './schema';
import { getProjectConfigurationPath } from './utils/get-project-configuration-path';

export const SCHEMA_OPTIONS_ARE_MUTUALLY_EXCLUSIVE =
  '--project and --all are mutually exclusive';

export async function validateSchema(schema: Schema) {
  if (schema.project && schema.all) {
    throw SCHEMA_OPTIONS_ARE_MUTUALLY_EXCLUSIVE;
  }

  if (!schema.project && !schema.all) {
    schema.project = (
      await prompt<{ project: string }>([
        {
          message: 'What project should be converted?',
          type: 'input',
          name: 'project',
        },
      ])
    ).project;
  }
}

export async function convertToNxProjectGenerator(host: Tree, schema: Schema) {
  await validateSchema(schema);

  const projects = schema.all
    ? getProjects(host).entries()
    : ([[schema.project, readProjectConfiguration(host, schema.project)]] as [
        string,
        ProjectConfiguration
      ][]);

  for (const [project, configuration] of projects) {
    const configPath = getProjectConfigurationPath(configuration);
    if (host.exists(configPath)) {
      logger.warn(`Skipping ${project} since ${configPath} already exists.`);
      continue;
    }

    writeJson(host, configPath, {
      $schema: getRelativeProjectJsonSchemaPath(host, configuration),
      ...configuration,
      root: undefined,
    });

    updateJson(host, getWorkspacePath(host), (value) => {
      value.projects[project] = normalizePath(dirname(configPath));
      return value;
    });
  }

  if (!schema.skipFormat) {
    await formatFiles(host);
  }
}

export default convertToNxProjectGenerator;

export const convertToNxProjectSchematic = convertNxGenerator(
  convertToNxProjectGenerator
);
