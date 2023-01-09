import {
  formatFiles,
  installPackagesTask,
  moveFilesToNewDirectory,
  readNxJson,
  Tree,
  updateNxJson,
} from '@nrwl/devkit';
import { wrapAngularDevkitSchematic } from '@nrwl/devkit/ngcli-adapter';
import { convertToNxProjectGenerator } from '@nrwl/workspace/generators';
import { UnitTestRunner } from '../../utils/test-runners';
import { angularInitGenerator } from '../init/init';
import { setupTailwindGenerator } from '../setup-tailwind/setup-tailwind';
import {
  addE2e,
  addLinting,
  addProxyConfig,
  addRouterRootConfiguration,
  addUnitTestRunner,
  convertToStandaloneApp,
  createFiles,
  enableStrictTypeChecking,
  normalizeOptions,
  setApplicationStrictDefault,
  updateAppComponentTemplate,
  updateComponentSpec,
  updateConfigFiles,
  updateEditorTsConfig,
  updateNxComponentTemplate,
} from './lib';
import type { Schema } from './schema';
import { getGeneratorDirectoryForInstalledAngularVersion } from '../../utils/get-generator-directory-for-ng-version';
import { join } from 'path';

export async function applicationGenerator(
  tree: Tree,
  schema: Partial<Schema>
) {
  const generatorDirectory =
    getGeneratorDirectoryForInstalledAngularVersion(tree);
  if (generatorDirectory) {
    let previousGenerator = await import(
      join(__dirname, generatorDirectory, 'application')
    );
    await previousGenerator.default(tree, schema);
    return;
  }

  const options = normalizeOptions(tree, schema);

  await angularInitGenerator(tree, {
    ...options,
    skipFormat: true,
  });

  const angularAppSchematic = wrapAngularDevkitSchematic(
    '@schematics/angular',
    'application'
  );
  await angularAppSchematic(tree, {
    name: options.name,
    inlineStyle: options.inlineStyle,
    inlineTemplate: options.inlineTemplate,
    prefix: options.prefix,
    skipTests: options.skipTests,
    style: options.style,
    viewEncapsulation: options.viewEncapsulation,
    routing: false,
    skipInstall: true,
    skipPackageJson: options.skipPackageJson,
  });

  if (options.ngCliSchematicAppRoot !== options.appProjectRoot) {
    moveFilesToNewDirectory(
      tree,
      options.ngCliSchematicAppRoot,
      options.appProjectRoot
    );
  }

  createFiles(tree, options);
  updateConfigFiles(tree, options);
  updateAppComponentTemplate(tree, options);

  if (!options.skipStarterTemplate) {
    // Create the NxWelcomeComponent
    const angularComponentSchematic = wrapAngularDevkitSchematic(
      '@schematics/angular',
      'component'
    );
    await angularComponentSchematic(tree, {
      name: 'NxWelcome',
      inlineTemplate: true,
      inlineStyle: true,
      prefix: options.prefix,
      skipTests: true,
      style: options.style,
      flat: true,
      viewEncapsulation: 'None',
      project: options.name,
      standalone: options.standalone,
    });
    updateNxComponentTemplate(tree, options);
  }

  if (options.addTailwind) {
    await setupTailwindGenerator(tree, {
      project: options.name,
      skipFormat: true,
      skipPackageJson: options.skipPackageJson,
    });
  }

  if (options.unitTestRunner !== UnitTestRunner.None) {
    updateComponentSpec(tree, options);
  }

  if (options.routing) {
    addRouterRootConfiguration(tree, options);
  }

  await addLinting(tree, options);
  await addUnitTestRunner(tree, options);
  await addE2e(tree, options);
  updateEditorTsConfig(tree, options);

  if (options.rootProject) {
    const nxJson = readNxJson(tree);
    nxJson.defaultProject = options.name;
    updateNxJson(tree, nxJson);
  }

  if (options.backendProject) {
    addProxyConfig(tree, options);
  }

  if (options.strict) {
    enableStrictTypeChecking(tree, options);
  } else {
    setApplicationStrictDefault(tree, false);
  }

  if (options.standaloneConfig) {
    await convertToNxProjectGenerator(tree, {
      project: options.name,
      all: false,
    });
  }

  if (options.standalone) {
    convertToStandaloneApp(tree, options);
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }

  return () => {
    installPackagesTask(tree);
  };
}

export default applicationGenerator;
