import { sync as globSync } from 'fast-glob';
import { existsSync, readFileSync } from 'fs';
import ignore, { Ignore } from 'ignore';
import * as path from 'path';
import { basename, dirname, join } from 'path';
import { performance } from 'perf_hooks';

import { workspaceRoot } from '../utils/workspace-root';
import { readJsonFile } from '../utils/fileutils';
import { logger, NX_PREFIX, stripIndent } from '../utils/logger';
import { loadNxPlugins, readPluginPackageJson } from '../utils/nx-plugin';
import * as yaml from 'js-yaml';

import type { NxJsonConfiguration, TargetDefaults } from './nx-json';
import {
  ProjectConfiguration,
  ProjectsConfigurations,
  TargetConfiguration,
} from './workspace-json-project-json';
import {
  CustomHasher,
  Executor,
  ExecutorConfig,
  ExecutorsJson,
  Generator,
  GeneratorsJson,
  TaskGraphExecutor,
} from './misc-interfaces';
import { PackageJson } from '../utils/package-json';
import { sortObjectByKeys } from '../utils/object-sort';
import { output } from '../utils/output';
import { joinPathFragments } from '../utils/path';

export function workspaceConfigName(
  root: string,
  opts?: {
    includeProjectsFromAngularJson;
  }
): 'angular.json' | 'workspace.json' | null {
  if (
    existsSync(path.join(root, 'angular.json')) &&
    // Include projects from angular.json if explicitly required.
    // e.g. when invoked from `packages/devkit/src/utils/convert-nx-executor.ts`
    (opts?.includeProjectsFromAngularJson ||
      // Or if a workspace has `@nrwl/angular` installed then projects from `angular.json` to be considered by Nx.
      isNrwlAngularInstalled())
  ) {
    return 'angular.json';
  } else if (existsSync(path.join(root, 'workspace.json'))) {
    return 'workspace.json';
  } else {
    return null;
  }
}

export class Workspaces {
  private cachedProjectsConfig: ProjectsConfigurations;

  constructor(private root: string) {}

  relativeCwd(cwd: string) {
    return path.relative(this.root, cwd).replace(/\\/g, '/') || null;
  }

  calculateDefaultProjectName(
    cwd: string,
    projects: ProjectsConfigurations,
    nxJson: NxJsonConfiguration
  ) {
    const relativeCwd = this.relativeCwd(cwd);
    if (relativeCwd) {
      const matchingProject = Object.keys(projects.projects).find((p) => {
        const projectRoot = projects.projects[p].root;
        return (
          relativeCwd == projectRoot ||
          relativeCwd.startsWith(`${projectRoot}/`)
        );
      });
      if (matchingProject) return matchingProject;
    }
    return nxJson.defaultProject;
  }

  readProjectsConfig(opts?: {
    _ignorePluginInference?: boolean;
    _includeProjectsFromAngularJson?: boolean;
  }): ProjectsConfigurations {
    if (
      this.cachedProjectsConfig &&
      process.env.NX_CACHE_PROJECTS_CONFIG !== 'false'
    ) {
      return this.cachedProjectsConfig;
    }
    const nxJson = this.readNxJson();
    const workspace = buildWorkspaceConfigurationFromGlobs(
      nxJson,
      globForProjectFiles(this.root, nxJson, opts?._ignorePluginInference),
      (path) => readJsonFile(join(this.root, path))
    );

    const workspaceFile = workspaceConfigName(this.root, {
      includeProjectsFromAngularJson: opts?._includeProjectsFromAngularJson,
    });

    if (workspaceFile) {
      workspace.projects = this.mergeWorkspaceJsonAndGlobProjects(
        this.readFromWorkspaceJson().projects,
        workspace.projects
      );
    }

    assertValidNxJson(nxJson);
    this.cachedProjectsConfig = this.mergeTargetDefaultsIntoProjectDescriptions(
      workspace,
      nxJson
    );
    return this.cachedProjectsConfig;
  }

  /**
   * Deprecated. Use readProjectsConfig
   */
  readWorkspaceConfiguration(opts?: {
    _ignorePluginInference?: boolean;
    _includeProjectsFromAngularJson?: boolean;
  }): ProjectsConfigurations & NxJsonConfiguration {
    const nxJson = this.readNxJson();
    return { ...this.readProjectsConfig(opts), ...nxJson };
  }

  private mergeWorkspaceJsonAndGlobProjects(
    workspaceJsonProjects: { [name: string]: any },
    globProjects: { [name: string]: any }
  ) {
    const res = workspaceJsonProjects;
    const folders = new Set();
    for (let k of Object.keys(res)) {
      folders.add(res[k].root);
    }

    for (let k of Object.keys(globProjects)) {
      if (!folders.has(globProjects[k].root)) {
        res[k] = globProjects[k];
      }
    }
    return res;
  }

  private mergeTargetDefaultsIntoProjectDescriptions(
    config: ProjectsConfigurations,
    nxJson: NxJsonConfiguration
  ) {
    for (const proj of Object.values(config.projects)) {
      if (proj.targets) {
        for (const targetName of Object.keys(proj.targets)) {
          const projectTargetDefinition = proj.targets[targetName];
          const defaults = readTargetDefaultsForTarget(
            targetName,
            nxJson.targetDefaults,
            projectTargetDefinition.executor
          );

          if (defaults) {
            proj.targets[targetName] = mergeTargetConfigurations(
              proj,
              targetName,
              defaults
            );
          }
        }
      }
    }
    return config;
  }

  isNxExecutor(nodeModule: string, executor: string) {
    return !this.readExecutor(nodeModule, executor).isNgCompat;
  }

  isNxGenerator(collectionName: string, generatorName: string) {
    return !this.readGenerator(collectionName, generatorName).isNgCompat;
  }

  readExecutor(
    nodeModule: string,
    executor: string
  ): ExecutorConfig & { isNgCompat: boolean } {
    try {
      const { executorsFilePath, executorConfig, isNgCompat } =
        this.readExecutorsJson(nodeModule, executor);
      const executorsDir = path.dirname(executorsFilePath);
      const schemaPath = path.join(executorsDir, executorConfig.schema || '');
      const schema = normalizeExecutorSchema(readJsonFile(schemaPath));

      const implementationFactory = this.getImplementationFactory<Executor>(
        executorConfig.implementation,
        executorsDir
      );

      const batchImplementationFactory = executorConfig.batchImplementation
        ? this.getImplementationFactory<TaskGraphExecutor>(
            executorConfig.batchImplementation,
            executorsDir
          )
        : null;

      const hasherFactory = executorConfig.hasher
        ? this.getImplementationFactory<CustomHasher>(
            executorConfig.hasher,
            executorsDir
          )
        : null;

      return {
        schema,
        implementationFactory,
        batchImplementationFactory,
        hasherFactory,
        isNgCompat,
      };
    } catch (e) {
      throw new Error(
        `Unable to resolve ${nodeModule}:${executor}.\n${e.message}`
      );
    }
  }

  readGenerator(collectionName: string, generatorName: string) {
    try {
      const {
        generatorsFilePath,
        generatorsJson,
        resolvedCollectionName,
        normalizedGeneratorName,
      } = this.readGeneratorsJson(collectionName, generatorName);
      const generatorsDir = path.dirname(generatorsFilePath);
      const generatorConfig =
        generatorsJson.generators?.[normalizedGeneratorName] ||
        generatorsJson.schematics?.[normalizedGeneratorName];
      const isNgCompat = !generatorsJson.generators?.[normalizedGeneratorName];
      const schemaPath = path.join(generatorsDir, generatorConfig.schema || '');
      const schema = readJsonFile(schemaPath);
      if (!schema.properties || typeof schema.properties !== 'object') {
        schema.properties = {};
      }
      generatorConfig.implementation =
        generatorConfig.implementation || generatorConfig.factory;
      const implementationFactory = this.getImplementationFactory<Generator>(
        generatorConfig.implementation,
        generatorsDir
      );
      return {
        resolvedCollectionName,
        normalizedGeneratorName,
        schema,
        implementationFactory,
        isNgCompat,
        aliases: generatorConfig.aliases || [],
      };
    } catch (e) {
      throw new Error(
        `Unable to resolve ${collectionName}:${generatorName}.\n${e.message}`
      );
    }
  }

  hasNxJson(): boolean {
    const nxJson = path.join(this.root, 'nx.json');
    return existsSync(nxJson);
  }

  readNxJson(): NxJsonConfiguration {
    const nxJson = path.join(this.root, 'nx.json');
    if (existsSync(nxJson)) {
      const nxJsonConfiguration = readJsonFile<NxJsonConfiguration>(nxJson);
      if (nxJsonConfiguration.extends) {
        const extendedNxJsonPath = require.resolve(
          nxJsonConfiguration.extends,
          {
            paths: [dirname(nxJson)],
          }
        );
        const baseNxJson =
          readJsonFile<NxJsonConfiguration>(extendedNxJsonPath);
        return this.mergeTargetDefaultsAndTargetDependencies({
          ...baseNxJson,
          ...nxJsonConfiguration,
        });
      } else {
        return this.mergeTargetDefaultsAndTargetDependencies(
          nxJsonConfiguration
        );
      }
    } else {
      try {
        return this.mergeTargetDefaultsAndTargetDependencies(
          readJsonFile(join(__dirname, '..', '..', 'presets', 'core.json'))
        );
      } catch (e) {
        return {};
      }
    }
  }

  private mergeTargetDefaultsAndTargetDependencies(
    nxJson: NxJsonConfiguration
  ) {
    if (!nxJson.targetDefaults) {
      nxJson.targetDefaults = {};
    }
    if (nxJson.targetDependencies) {
      for (const targetName of Object.keys(nxJson.targetDependencies)) {
        if (!nxJson.targetDefaults[targetName]) {
          nxJson.targetDefaults[targetName] = {};
        }
        if (!nxJson.targetDefaults[targetName].dependsOn) {
          nxJson.targetDefaults[targetName].dependsOn = [];
        }
        nxJson.targetDefaults[targetName].dependsOn = [
          ...nxJson.targetDefaults[targetName].dependsOn,
          ...nxJson.targetDependencies[targetName],
        ];
      }
    }
    return nxJson;
  }

  private getImplementationFactory<T>(
    implementation: string,
    directory: string
  ): () => T {
    const [implementationModulePath, implementationExportName] =
      implementation.split('#');
    return () => {
      const module = require(path.join(directory, implementationModulePath));
      return implementationExportName
        ? module[implementationExportName]
        : module.default ?? module;
    };
  }

  private readExecutorsJson(nodeModule: string, executor: string) {
    const { json: packageJson, path: packageJsonPath } = readPluginPackageJson(
      nodeModule,
      this.resolvePaths()
    );
    const executorsFile = packageJson.executors ?? packageJson.builders;

    if (!executorsFile) {
      throw new Error(
        `The "${nodeModule}" package does not support Nx executors.`
      );
    }

    const executorsFilePath = require.resolve(
      path.join(path.dirname(packageJsonPath), executorsFile)
    );
    const executorsJson = readJsonFile<ExecutorsJson>(executorsFilePath);
    const executorConfig: {
      implementation: string;
      batchImplementation?: string;
      schema: string;
      hasher?: string;
    } =
      executorsJson.executors?.[executor] || executorsJson.builders?.[executor];
    if (!executorConfig) {
      throw new Error(
        `Cannot find executor '${executor}' in ${executorsFilePath}.`
      );
    }
    const isNgCompat = !executorsJson.executors?.[executor];
    return { executorsFilePath, executorConfig, isNgCompat };
  }

  private readGeneratorsJson(
    collectionName: string,
    generator: string
  ): {
    generatorsFilePath: string;
    generatorsJson: GeneratorsJson;
    normalizedGeneratorName: string;
    resolvedCollectionName: string;
  } {
    let generatorsFilePath;
    if (collectionName.endsWith('.json')) {
      generatorsFilePath = require.resolve(collectionName, {
        paths: this.resolvePaths(),
      });
    } else {
      const { json: packageJson, path: packageJsonPath } =
        readPluginPackageJson(collectionName, this.resolvePaths());
      const generatorsFile = packageJson.generators ?? packageJson.schematics;

      if (!generatorsFile) {
        throw new Error(
          `The "${collectionName}" package does not support Nx generators.`
        );
      }

      generatorsFilePath = require.resolve(
        path.join(path.dirname(packageJsonPath), generatorsFile)
      );
    }
    const generatorsJson = readJsonFile<GeneratorsJson>(generatorsFilePath);

    let normalizedGeneratorName =
      findFullGeneratorName(generator, generatorsJson.generators) ||
      findFullGeneratorName(generator, generatorsJson.schematics);

    if (!normalizedGeneratorName) {
      for (let parent of generatorsJson.extends || []) {
        try {
          return this.readGeneratorsJson(parent, generator);
        } catch (e) {}
      }

      throw new Error(
        `Cannot find generator '${generator}' in ${generatorsFilePath}.`
      );
    }
    return {
      generatorsFilePath,
      generatorsJson,
      normalizedGeneratorName,
      resolvedCollectionName: collectionName,
    };
  }

  private resolvePaths() {
    return this.root ? [this.root, __dirname] : [__dirname];
  }

  private readFromWorkspaceJson() {
    const rawWorkspace = readJsonFile(
      path.join(this.root, workspaceConfigName(this.root))
    );
    return resolveNewFormatWithInlineProjects(rawWorkspace, this.root);
  }
}

function normalizeExecutorSchema(
  schema: Partial<ExecutorConfig['schema']>
): ExecutorConfig['schema'] {
  const version = (schema.version ??= 1);
  return {
    version,
    outputCapture:
      schema.outputCapture ?? version < 2 ? 'direct-nodejs' : 'pipe',
    properties:
      !schema.properties || typeof schema.properties !== 'object'
        ? {}
        : schema.properties,
    ...schema,
  };
}

function assertValidNxJson(nxJson: NxJsonConfiguration & { projects?: any }) {
  // Assert valid workspace configuration
  if (nxJson.projects) {
    logger.warn(
      'NX As of Nx 13, project configuration should be moved from nx.json to workspace.json/project.json. Please run "nx format" to fix this.'
    );
  }
}

function isNrwlAngularInstalled() {
  try {
    require.resolve('@nrwl/angular');
    return true;
  } catch {
    return false;
  }
}

function findFullGeneratorName(
  name: string,
  generators: {
    [name: string]: { aliases?: string[] };
  }
) {
  if (generators) {
    for (let [key, data] of Object.entries<{ aliases?: string[] }>(
      generators
    )) {
      if (
        key === name ||
        (data.aliases && (data.aliases as string[]).includes(name))
      ) {
        return key;
      }
    }
  }
}

export function reformattedWorkspaceJsonOrNull(w: any) {
  const workspaceJson =
    w.version === 2 ? toNewFormatOrNull(w) : toOldFormatOrNull(w);
  if (workspaceJson?.projects) {
    workspaceJson.projects = sortObjectByKeys(workspaceJson.projects);
  }

  return workspaceJson;
}

export function toNewFormat(w: any): ProjectsConfigurations {
  const f = toNewFormatOrNull(w);
  return f ?? w;
}

export function toNewFormatOrNull(w: any) {
  let formatted = false;
  Object.values(w.projects || {}).forEach((projectConfig: any) => {
    if (projectConfig.architect) {
      renamePropertyWithStableKeys(projectConfig, 'architect', 'targets');
      formatted = true;
    }
    if (projectConfig.schematics) {
      renamePropertyWithStableKeys(projectConfig, 'schematics', 'generators');
      formatted = true;
    }
    Object.values(projectConfig.targets || {}).forEach((target: any) => {
      if (target.builder !== undefined) {
        renamePropertyWithStableKeys(target, 'builder', 'executor');
        formatted = true;
      }
    });
  });
  if (w.schematics) {
    renamePropertyWithStableKeys(w, 'schematics', 'generators');
    formatted = true;
  }
  if (w.version !== 2) {
    w.version = 2;
    formatted = true;
  }
  return formatted ? w : null;
}

export function toOldFormatOrNull(w: any) {
  let formatted = false;

  Object.values(w.projects || {}).forEach((projectConfig: any) => {
    if (typeof projectConfig === 'string') {
      throw new Error(
        "'project.json' files are incompatible with version 1 workspace schemas."
      );
    }
    if (projectConfig.targets) {
      renamePropertyWithStableKeys(projectConfig, 'targets', 'architect');
      formatted = true;
    }
    if (projectConfig.generators) {
      renamePropertyWithStableKeys(projectConfig, 'generators', 'schematics');
      formatted = true;
    }
    delete projectConfig.name;
    Object.values(projectConfig.architect || {}).forEach((target: any) => {
      if (target.executor !== undefined) {
        renamePropertyWithStableKeys(target, 'executor', 'builder');
        formatted = true;
      }
    });
  });

  if (w.generators) {
    renamePropertyWithStableKeys(w, 'generators', 'schematics');
    formatted = true;
  }
  if (w.version !== 1) {
    w.version = 1;
    formatted = true;
  }
  return formatted ? w : null;
}

export function resolveOldFormatWithInlineProjects(
  w: any,
  root: string = workspaceRoot
) {
  const inlined = inlineProjectConfigurations(w, root);
  const formatted = toOldFormatOrNull(inlined);
  return formatted ? formatted : inlined;
}

export function resolveNewFormatWithInlineProjects(
  w: any,
  root: string = workspaceRoot
) {
  return toNewFormat(inlineProjectConfigurations(w, root));
}

function inlineProjectConfigurations(w: any, root: string = workspaceRoot) {
  Object.entries(w.projects || {}).forEach(
    ([project, config]: [string, any]) => {
      if (typeof config === 'string') {
        const configFilePath = path.join(root, config, 'project.json');
        const fileConfig = readJsonFile(configFilePath);
        w.projects[project] = {
          root: config,
          ...fileConfig,
        };
      }
    }
  );
  return w;
}

/**
 * Reads an nx.json file from a given path or extends a local nx.json config.
 */

/**
 * Pulled from toFileName in names from @nrwl/devkit.
 * Todo: Should refactor, not duplicate.
 */
export function toProjectName(fileName: string): string {
  const parts = dirname(fileName).split(/[\/\\]/g);
  return parts[parts.length - 1].toLowerCase();
}

let projectGlobCache: string[];
let projectGlobCacheKey: string;

export function getGlobPatternsFromPlugins(
  nxJson: NxJsonConfiguration,
  paths: string[],
  root = workspaceRoot
): string[] {
  const plugins = loadNxPlugins(nxJson?.plugins, paths, root);

  const patterns = [];
  for (const plugin of plugins) {
    if (!plugin.projectFilePatterns) {
      continue;
    }
    for (const filePattern of plugin.projectFilePatterns) {
      patterns.push('**/' + filePattern);
    }
  }

  return patterns;
}

/**
 * Get the package.json globs from package manager workspaces
 */
export function getGlobPatternsFromPackageManagerWorkspaces(
  root: string
): string[] {
  try {
    const patterns: string[] = [];
    const packageJson = readJsonFile<PackageJson>(join(root, 'package.json'));

    patterns.push(
      ...normalizePatterns(
        Array.isArray(packageJson.workspaces)
          ? packageJson.workspaces
          : packageJson.workspaces?.packages ?? []
      )
    );

    if (existsSync(join(root, 'pnpm-workspace.yaml'))) {
      try {
        const obj = yaml.load(
          readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf-8')
        ) as { packages: string[] };
        patterns.push(...normalizePatterns(obj.packages || []));
      } catch (e: unknown) {
        output.warn({
          title: `${NX_PREFIX} Unable to parse pnpm-workspace.yaml`,
          bodyLines: [e.toString()],
        });
      }
    }

    if (existsSync(join(root, 'lerna.json'))) {
      try {
        const { packages } = readJsonFile<any>(join(root, 'lerna.json'));
        patterns.push(
          ...normalizePatterns(packages?.length > 0 ? packages : ['packages/*'])
        );
      } catch (e: unknown) {
        output.warn({
          title: `${NX_PREFIX} Unable to parse lerna.json`,
          bodyLines: [e.toString()],
        });
      }
    }

    // Merge patterns from workspaces definitions
    // TODO(@AgentEnder): update logic after better way to determine root project inclusion
    // Include the root project
    return packageJson.nx ? patterns.concat('package.json') : patterns;
  } catch {}
}

function normalizePatterns(patterns: string[]): string[] {
  return patterns.map((pattern) =>
    removeRelativePath(
      pattern.endsWith('/package.json')
        ? pattern
        : joinPathFragments(pattern, 'package.json')
    )
  );
}

function removeRelativePath(pattern: string): string {
  return pattern.startsWith('./') ? pattern.substring(2) : pattern;
}

export function globForProjectFiles(
  root,
  nxJson?: NxJsonConfiguration,
  ignorePluginInference = false
) {
  // Deal w/ Caching
  const cacheKey = [root, ...(nxJson?.plugins || [])].join(',');
  if (
    process.env.NX_PROJECT_GLOB_CACHE !== 'false' &&
    projectGlobCache &&
    cacheKey === projectGlobCacheKey
  ) {
    return projectGlobCache;
  }
  projectGlobCacheKey = cacheKey;

  const _globPatternsFromPackageManagerWorkspaces =
    getGlobPatternsFromPackageManagerWorkspaces(root);

  const globPatternsFromPackageManagerWorkspaces =
    _globPatternsFromPackageManagerWorkspaces ?? [];

  const globsToInclude = globPatternsFromPackageManagerWorkspaces.filter(
    (glob) => !glob.startsWith('!')
  );

  const globsToExclude = globPatternsFromPackageManagerWorkspaces
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => glob.substring(1))
    .map((glob) => (glob.startsWith('/') ? glob.substring(1) : glob));

  const projectGlobPatterns: string[] = [
    'project.json',
    '**/project.json',
    ...globsToInclude,
  ];

  if (!ignorePluginInference) {
    projectGlobPatterns.push(
      ...getGlobPatternsFromPlugins(nxJson, [root], root)
    );
  }

  const combinedProjectGlobPattern = '{' + projectGlobPatterns.join(',') + '}';

  performance.mark('start-glob-for-projects');
  /**
   * This configures the files and directories which we always want to ignore as part of file watching
   * and which we know the location of statically (meaning irrespective of user configuration files).
   * This has the advantage of being ignored directly within globSync
   *
   * Other ignored entries will need to be determined dynamically by reading and evaluating the user's
   * .gitignore and .nxignore files below.
   */

  const ALWAYS_IGNORE = [
    'node_modules',
    '**/node_modules',
    'dist',
    '.git',
    ...globsToExclude,
  ];

  /**
   * TODO: This utility has been implemented multiple times across the Nx codebase,
   * discuss whether it should be moved to a shared location.
   */
  const ig = ignore();
  try {
    ig.add(readFileSync(`${root}/.gitignore`, 'utf-8'));
  } catch {}
  try {
    ig.add(readFileSync(`${root}/.nxignore`, 'utf-8'));
  } catch {}

  const globResults = globSync(combinedProjectGlobPattern, {
    ignore: ALWAYS_IGNORE,
    absolute: false,
    cwd: root,
    dot: true,
    suppressErrors: true,
  });

  projectGlobCache = deduplicateProjectFiles(globResults, ig);

  // TODO @vsavkin remove after Nx 16
  if (
    projectGlobCache.length === 0 &&
    _globPatternsFromPackageManagerWorkspaces === undefined &&
    nxJson?.extends === 'nx/presets/npm.json'
  ) {
    output.warn({
      title:
        'Nx could not find any projects. Check if you need to configure workspaces in package.json or pnpm-workspace.yaml',
    });
  }

  performance.mark('finish-glob-for-projects');
  performance.measure(
    'glob-for-project-files',
    'start-glob-for-projects',
    'finish-glob-for-projects'
  );
  return projectGlobCache;
}

export function deduplicateProjectFiles(
  files: string[],
  ig?: Ignore
): string[] {
  const filtered = new Map();
  files.forEach((file) => {
    const projectFolder = dirname(file);
    const projectFile = basename(file);
    if (ig?.ignores(file)) return; // file is in .gitignore or .nxignoreb
    if (filtered.has(projectFolder) && projectFile !== 'project.json') return;
    filtered.set(projectFolder, projectFile);
  });

  return Array.from(filtered.entries()).map(([folder, file]) =>
    join(folder, file)
  );
}

function buildProjectConfigurationFromPackageJson(
  path: string,
  packageJson: { name: string },
  nxJson: NxJsonConfiguration
): ProjectConfiguration & { name: string } {
  const normalizedPath = path.split('\\').join('/');
  const directory = dirname(normalizedPath);
  let name = packageJson.name ?? toProjectName(normalizedPath);
  if (nxJson?.npmScope) {
    const npmPrefix = `@${nxJson.npmScope}/`;
    if (name.startsWith(npmPrefix)) {
      name = name.replace(npmPrefix, '');
    }
  }
  const projectType =
    nxJson?.workspaceLayout?.appsDir != nxJson?.workspaceLayout?.libsDir &&
    nxJson?.workspaceLayout?.appsDir &&
    directory.startsWith(nxJson.workspaceLayout.appsDir)
      ? 'application'
      : 'library';
  return {
    root: directory,
    sourceRoot: directory,
    name,
    projectType,
  };
}

export function inferProjectFromNonStandardFile(
  file: string,
  nxJson: NxJsonConfiguration
): ProjectConfiguration & { name: string } {
  const directory = dirname(file).split('\\').join('/');

  return {
    name: toProjectName(file),
    root: directory,
  };
}

export function buildWorkspaceConfigurationFromGlobs(
  nxJson: NxJsonConfiguration,
  projectFiles: string[], // making this parameter allows devkit to pick up newly created projects
  readJson: <T extends Object>(string) => T = <T extends Object>(string) =>
    readJsonFile<T>(string) // making this an arg allows us to reuse in devkit
): ProjectsConfigurations {
  const projects: Record<string, ProjectConfiguration> = {};

  for (const file of projectFiles) {
    const directory = dirname(file).split('\\').join('/');
    const fileName = basename(file);

    if (fileName === 'project.json') {
      //  Nx specific project configuration (`project.json` files) in the same
      // directory as a package.json should overwrite the inferred package.json
      // project configuration.
      const configuration = readJson<ProjectConfiguration>(file);

      configuration.root = directory;

      let name = configuration.name;
      if (!configuration.name) {
        name = toProjectName(file);
      }
      if (!projects[name]) {
        projects[name] = configuration;
      } else {
        logger.warn(
          `Skipping project found at ${directory} since project ${name} already exists at ${projects[name].root}! Specify a unique name for the project to allow Nx to differentiate between the two projects.`
        );
      }
    } else {
      // We can infer projects from package.json files,
      // if a package.json file is in a directory w/o a `project.json` file.
      // this results in targets being inferred by Nx from package scripts,
      // and the root / sourceRoot both being the directory.
      if (fileName === 'package.json') {
        const projectPackageJson = readJson<PackageJson>(file);
        const { name, ...config } = buildProjectConfigurationFromPackageJson(
          file,
          projectPackageJson,
          nxJson
        );
        if (!projects[name]) {
          projects[name] = config;
        } else {
          logger.warn(
            `Skipping project found at ${directory} since project ${name} already exists at ${projects[name].root}! Specify a unique name for the project to allow Nx to differentiate between the two projects.`
          );
        }
      } else {
        // This project was created from an nx plugin.
        // The only thing we know about the file is its location
        const { name, ...config } = inferProjectFromNonStandardFile(
          file,
          nxJson
        );
        if (!projects[name]) {
          projects[name] = config;
        } else {
          logger.error(
            `Skipping project inferred from ${file} since project ${name} already exists.`
          );
          throw new Error();
        }
      }
    }
  }

  return {
    version: 2,
    projects: projects,
  };
}

export function mergeTargetConfigurations(
  projectConfiguration: ProjectConfiguration,
  target: string,
  targetDefaults: TargetDefaults[string]
): TargetConfiguration {
  const targetConfiguration = projectConfiguration.targets?.[target];

  if (!targetConfiguration) {
    throw new Error(
      `Attempted to merge targetDefaults for ${projectConfiguration.name}.${target}, which doesn't exist.`
    );
  }

  const {
    configurations: defaultConfigurations,
    options: defaultOptions,
    ...defaults
  } = targetDefaults;
  const result = {
    ...defaults,
    ...targetConfiguration,
  };

  // Target is "compatible", e.g. executor is defined only once or is the same
  // in both places. This means that it is likely safe to merge options
  if (
    !targetDefaults.executor ||
    !targetConfiguration.executor ||
    targetDefaults.executor === targetConfiguration.executor
  ) {
    result.options = mergeOptions(
      defaultOptions,
      targetConfiguration.options ?? {},
      projectConfiguration,
      target
    );
    result.configurations = mergeConfigurations(
      defaultConfigurations,
      targetConfiguration.configurations,
      projectConfiguration,
      target
    );
  }
  return result as TargetConfiguration;
}

function mergeOptions<T extends Object>(
  defaults: T,
  options: T,
  project: ProjectConfiguration,
  key: string
): T {
  return {
    ...resolvePathTokensInOptions(defaults, project, key),
    ...options,
  };
}

function mergeConfigurations<T extends Object>(
  defaultConfigurations: Record<string, T>,
  projectDefinedConfigurations: Record<string, T>,
  project: ProjectConfiguration,
  targetName: string
): Record<string, T> {
  const configurations: Record<string, T> = { ...projectDefinedConfigurations };
  for (const configuration in defaultConfigurations) {
    configurations[configuration] = mergeOptions(
      defaultConfigurations[configuration],
      configurations[configuration],
      project,
      `${targetName}.${configuration}`
    );
  }
  return configurations;
}

function resolvePathTokensInOptions<T extends Object | Array<unknown>>(
  object: T,
  project: ProjectConfiguration,
  key: string
): T {
  const result: T = Array.isArray(object) ? ([...object] as T) : { ...object };
  for (let [opt, value] of Object.entries(object ?? {})) {
    if (typeof value === 'string') {
      if (value.startsWith('{workspaceRoot}/')) {
        value = value.replace(/^\{workspaceRoot\}\//, '');
      }
      if (value.includes('{workspaceRoot}')) {
        throw new Error(
          `${NX_PREFIX} The {workspaceRoot} token is only valid at the beginning of an option. (${key})`
        );
      }
      value = value.replace('{projectRoot}', project.root);
      result[opt] = value.replace('{projectName}', project.name);
    } else if (typeof value === 'object' && value) {
      result[opt] = resolvePathTokensInOptions(
        value,
        project,
        [key, opt].join('.')
      );
    }
  }
  return result;
}

export function readTargetDefaultsForTarget(
  targetName: string,
  targetDefaults: TargetDefaults,
  executor?: string
): TargetDefaults[string] {
  if (executor) {
    // If an executor is defined in project.json, defaults should be read
    // from the most specific key that matches that executor.
    // e.g. If executor === run-commands, and the target is named build:
    // Use, use nx:run-commands if it is present
    // If not, use build if it is present.
    const key = [executor, targetName].find((x) => targetDefaults?.[x]);
    return key ? targetDefaults?.[key] : null;
  } else {
    // If the executor is not defined, the only key we have is the target name.
    return targetDefaults?.[targetName];
  }
}

// we have to do it this way to preserve the order of properties
// not to screw up the formatting
export function renamePropertyWithStableKeys(
  obj: any,
  from: string,
  to: string
) {
  const copy = { ...obj };
  Object.keys(obj).forEach((k) => {
    delete obj[k];
  });
  Object.keys(copy).forEach((k) => {
    if (k === from) {
      obj[to] = copy[k];
    } else {
      obj[k] = copy[k];
    }
  });
}
