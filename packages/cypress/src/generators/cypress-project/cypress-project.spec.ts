import {
  addProjectConfiguration,
  readJson,
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
  WorkspaceJsonConfiguration,
} from '@nrwl/devkit';
import { createTreeWithEmptyV1Workspace } from '@nrwl/devkit/testing';
import { cypressProjectGenerator } from './cypress-project';
import { Schema } from './schema';
import { Linter } from '@nrwl/linter';
import { installedCypressVersion } from '../../utils/cypress-version';
import { cypressInitGenerator } from '../init/init';

jest.mock('../../utils/cypress-version');
jest.mock('../init/init');
describe('Cypress Project', () => {
  let tree: Tree;
  const defaultOptions: Omit<Schema, 'name' | 'project'> = {
    linter: Linter.EsLint,
    standaloneConfig: false,
  };
  let mockedInstalledCypressVersion: jest.Mock<
    ReturnType<typeof installedCypressVersion>
  > = installedCypressVersion as never;
  let mockInitCypress: jest.Mock<ReturnType<typeof cypressInitGenerator>> =
    cypressInitGenerator as never;

  beforeEach(() => {
    tree = createTreeWithEmptyV1Workspace();

    addProjectConfiguration(tree, 'my-app', {
      root: 'my-app',
      targets: {
        serve: {
          executor: 'serve-executor',
          options: {},
          configurations: {
            production: {},
          },
        },
      },
    });

    addProjectConfiguration(tree, 'my-dir-my-app', {
      root: 'my-dir/my-app',
      targets: {
        serve: {
          executor: 'serve-executor',
          options: {},
          configurations: {
            production: {},
          },
        },
      },
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('should call init if cypress is not installed', async () => {
    mockedInstalledCypressVersion.mockReturnValue(null);
    await cypressProjectGenerator(tree, {
      ...defaultOptions,
      name: 'my-app-e2e',
      project: 'my-app',
    });
    expect(mockInitCypress).toHaveBeenCalled();
  });

  it('should call not init if cypress is installed', async () => {
    mockedInstalledCypressVersion.mockReturnValue(10);
    await cypressProjectGenerator(tree, {
      ...defaultOptions,
      name: 'my-app-e2e',
      project: 'my-app',
    });
    expect(mockInitCypress).not.toHaveBeenCalled();
  });

  describe('> v10', () => {
    beforeEach(() => {
      mockedInstalledCypressVersion.mockReturnValue(10);
    });

    it('should generate files for v10 and above', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });

      expect(tree.exists('apps/my-app-e2e/cypress.config.ts')).toBeTruthy();

      expect(
        tree.exists('apps/my-app-e2e/src/fixtures/example.json')
      ).toBeTruthy();
      expect(tree.exists('apps/my-app-e2e/src/e2e/app.cy.ts')).toBeTruthy();
      expect(tree.exists('apps/my-app-e2e/src/support/app.po.ts')).toBeTruthy();
      expect(
        tree.exists('apps/my-app-e2e/src/support/commands.ts')
      ).toBeTruthy();
      expect(tree.exists('apps/my-app-e2e/src/support/e2e.ts')).toBeTruthy();
    });

    it('should add update `workspace.json` file properly when eslint is passed', async () => {
      await cypressProjectGenerator(tree, {
        name: 'my-app-e2e',
        project: 'my-app',
        linter: Linter.EsLint,
        standaloneConfig: false,
      });
      const workspaceJson = readJson(tree, 'workspace.json');
      const project = workspaceJson.projects['my-app-e2e'];

      expect(project.architect.lint).toMatchSnapshot();
    });

    it('should not add lint target when "none" is passed', async () => {
      await cypressProjectGenerator(tree, {
        name: 'my-app-e2e',
        project: 'my-app',
        linter: Linter.None,
        standaloneConfig: false,
      });
      const workspaceJson = readJson(tree, 'workspace.json');
      const project = workspaceJson.projects['my-app-e2e'];

      expect(project.architect.lint).toBeUndefined();
    });

    it('should update tags and implicit dependencies', async () => {
      await cypressProjectGenerator(tree, {
        name: 'my-app-e2e',
        project: 'my-app',
        linter: Linter.EsLint,
        standaloneConfig: false,
      });

      const project = readProjectConfiguration(tree, 'my-app-e2e');
      expect(project.tags).toEqual([]);
      expect(project.implicitDependencies).toEqual(['my-app']);
    });

    it('should set right path names in `cypress.config.ts`', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });
      const cypressConfig = tree.read(
        'apps/my-app-e2e/cypress.config.ts',
        'utf-8'
      );
      expect(cypressConfig).toMatchSnapshot();
    });

    it('should set right path names in `tsconfig.e2e.json`', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });
      const tsconfigJson = readJson(tree, 'apps/my-app-e2e/tsconfig.json');
      expect(tsconfigJson).toMatchSnapshot();
    });

    it('should extend from tsconfig.base.json', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });

      const tsConfig = readJson(tree, 'apps/my-app-e2e/tsconfig.json');
      expect(tsConfig.extends).toBe('../../tsconfig.base.json');
    });

    it('should support a root tsconfig.json instead of tsconfig.base.json', async () => {
      tree.rename('tsconfig.base.json', 'tsconfig.json');

      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });

      const tsConfig = readJson(tree, 'apps/my-app-e2e/tsconfig.json');
      expect(tsConfig.extends).toBe('../../tsconfig.json');
    });

    describe('for bundler:vite', () => {
      it('should pass the bundler info to nxE2EPreset in `cypress.config.ts`', async () => {
        await cypressProjectGenerator(tree, {
          ...defaultOptions,
          name: 'my-app-e2e',
          project: 'my-app',
          bundler: 'vite',
        });
        const cypressConfig = tree.read(
          'apps/my-app-e2e/cypress.config.ts',
          'utf-8'
        );
        expect(cypressConfig).toMatchSnapshot();
      });
    });

    describe('nested', () => {
      it('should set right path names in `cypress.config.ts`', async () => {
        await cypressProjectGenerator(tree, {
          ...defaultOptions,
          name: 'my-app-e2e',
          project: 'my-dir-my-app',
          directory: 'my-dir',
        });

        const cypressConfig = tree.read(
          'apps/my-dir/my-app-e2e/cypress.config.ts',
          'utf-8'
        );
        expect(cypressConfig).toMatchSnapshot();
      });

      it('should set right path names in `tsconfig.e2e.json`', async () => {
        await cypressProjectGenerator(tree, {
          ...defaultOptions,
          name: 'my-app-e2e',
          project: 'my-dir-my-app',
          directory: 'my-dir',
        });
        const tsconfigJson = readJson(
          tree,
          'apps/my-dir/my-app-e2e/tsconfig.json'
        );

        expect(tsconfigJson).toMatchSnapshot();
      });

      it('should extend from tsconfig.base.json', async () => {
        await cypressProjectGenerator(tree, {
          ...defaultOptions,
          name: 'my-app-e2e',
          project: 'my-app',
          directory: 'my-dir',
        });

        const tsConfig = readJson(tree, 'apps/my-dir/my-app-e2e/tsconfig.json');
        expect(tsConfig.extends).toBe('../../../tsconfig.base.json');
      });

      it('should support a root tsconfig.json instead of tsconfig.base.json', async () => {
        tree.rename('tsconfig.base.json', 'tsconfig.json');

        await cypressProjectGenerator(tree, {
          ...defaultOptions,
          name: 'my-app-e2e',
          project: 'my-app',
          directory: 'my-dir',
        });

        const tsConfig = readJson(tree, 'apps/my-dir/my-app-e2e/tsconfig.json');
        expect(tsConfig.extends).toBe('../../../tsconfig.json');
      });

      describe('root project', () => {
        it('should generate in option.name when root project detected', async () => {
          addProjectConfiguration(tree, 'root', {
            root: '.',
          });
          await cypressProjectGenerator(tree, {
            ...defaultOptions,
            name: 'e2e-tests',
            baseUrl: 'http://localhost:1234',
            project: 'root',
            rootProject: true,
          });
          expect(tree.listChanges().map((c) => c.path)).toEqual(
            expect.arrayContaining([
              'e2e-tests/cypress.config.ts',
              'e2e-tests/src/e2e/app.cy.ts',
              'e2e-tests/src/fixtures/example.json',
              'e2e-tests/src/support/app.po.ts',
              'e2e-tests/src/support/commands.ts',
              'e2e-tests/src/support/e2e.ts',
              'e2e-tests/tsconfig.json',
            ])
          );
        });

        it('should not generate a root project when the passed in project is not the root project', async () => {
          addProjectConfiguration(tree, 'root', {
            root: '.',
          });
          addProjectConfiguration(tree, 'my-cool-app', {
            root: 'apps/my-app',
          });
          await cypressProjectGenerator(tree, {
            ...defaultOptions,
            name: 'e2e-tests',
            baseUrl: 'http://localhost:1234',
            project: 'my-app',
          });
          expect(tree.listChanges().map((c) => c.path)).toEqual(
            expect.arrayContaining([
              'apps/e2e-tests/cypress.config.ts',
              'apps/e2e-tests/src/e2e/app.cy.ts',
              'apps/e2e-tests/src/fixtures/example.json',
              'apps/e2e-tests/src/support/app.po.ts',
              'apps/e2e-tests/src/support/commands.ts',
              'apps/e2e-tests/src/support/e2e.ts',
              'apps/e2e-tests/tsconfig.json',
            ])
          );
        });
      });
    });

    describe('--project', () => {
      describe('none', () => {
        it('should not add any implicit dependencies', async () => {
          await cypressProjectGenerator(tree, {
            ...defaultOptions,
            name: 'my-app-e2e',
            baseUrl: 'http://localhost:7788',
          });

          const workspaceJson = readJson<WorkspaceJsonConfiguration>(
            tree,
            'workspace.json'
          );
          const projectConfig = workspaceJson.projects['my-app-e2e'];
          expect(projectConfig.implicitDependencies).not.toBeDefined();
          expect(projectConfig.tags).toEqual([]);
        });
      });

      it('should not throw an error when --project does not have targets', async () => {
        const projectConf = readProjectConfiguration(tree, 'my-app');
        delete projectConf.targets;

        updateProjectConfiguration(tree, 'my-app', projectConf);
        await cypressProjectGenerator(tree, {
          name: 'my-app-e2e',
          project: 'my-app',
          linter: Linter.EsLint,
        });

        const projectConfig = readProjectConfiguration(tree, 'my-app-e2e');
        expect(projectConfig.targets['e2e'].options.devServerTarget).toEqual(
          'my-app:serve'
        );
      });
    });

    it('should generate in the correct folder', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'other-e2e',
        project: 'my-app',
        directory: 'one/two',
      });
      const workspace = readJson(tree, 'workspace.json');
      expect(workspace.projects['one-two-other-e2e']).toBeDefined();
      [
        'apps/one/two/other-e2e/cypress.config.ts',
        'apps/one/two/other-e2e/src/e2e/app.cy.ts',
      ].forEach((path) => expect(tree.exists(path)).toBeTruthy());
    });
  });

  describe('v9 - v7', () => {
    beforeEach(() => {
      mockedInstalledCypressVersion.mockReturnValue(9);
    });
    it('should generate files', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });

      expect(tree.exists('apps/my-app-e2e/cypress.json')).toBeTruthy();

      expect(
        tree.exists('apps/my-app-e2e/src/fixtures/example.json')
      ).toBeTruthy();
      expect(
        tree.exists('apps/my-app-e2e/src/integration/app.spec.ts')
      ).toBeTruthy();
      expect(tree.exists('apps/my-app-e2e/src/support/app.po.ts')).toBeTruthy();
      expect(
        tree.exists('apps/my-app-e2e/src/support/commands.ts')
      ).toBeTruthy();
      expect(tree.exists('apps/my-app-e2e/src/support/index.ts')).toBeTruthy();
    });
  });

  describe('< v7', () => {
    beforeEach(() => {
      mockedInstalledCypressVersion.mockReturnValue(6);
    });

    it('should generate a plugin file if cypress is below version 7', async () => {
      await cypressProjectGenerator(tree, {
        ...defaultOptions,
        name: 'my-app-e2e',
        project: 'my-app',
      });

      expect(tree.exists('apps/my-app-e2e/src/plugins/index.js')).toBeTruthy();
    });

    it('should add update `workspace.json` file', async () => {
      await cypressProjectGenerator(tree, {
        name: 'my-app-e2e',
        project: 'my-app',
        linter: Linter.EsLint,
        standaloneConfig: false,
      });
      const workspaceJson = readJson(tree, 'workspace.json');
      const project = workspaceJson.projects['my-app-e2e'];

      expect(project.root).toEqual('apps/my-app-e2e');

      expect(project.architect).toMatchSnapshot();
    });

    it('should add update `workspace.json` file (baseUrl)', async () => {
      await cypressProjectGenerator(tree, {
        name: 'my-app-e2e',
        project: 'my-app',
        baseUrl: 'http://localhost:3000',
        linter: Linter.EsLint,
        standaloneConfig: false,
      });
      const workspaceJson = readJson(tree, 'workspace.json');
      const project = workspaceJson.projects['my-app-e2e'];

      expect(project.root).toEqual('apps/my-app-e2e');

      expect(project.architect).toMatchSnapshot();
    });

    it('should add update `workspace.json` file for a project with a defaultConfiguration', async () => {
      const originalProject = readProjectConfiguration(tree, 'my-app');
      originalProject.targets.serve.defaultConfiguration = 'development';
      originalProject.targets.serve.configurations.development = {};
      updateProjectConfiguration(tree, 'my-app', originalProject);

      await cypressProjectGenerator(tree, {
        name: 'my-app-e2e',
        project: 'my-app',
        linter: Linter.EsLint,
        standaloneConfig: false,
      });
      const workspaceJson = readJson(tree, 'workspace.json');
      const project = workspaceJson.projects['my-app-e2e'];

      expect(project.root).toEqual('apps/my-app-e2e');

      expect(project.architect).toMatchSnapshot();
    });

    describe('nested', () => {
      it('should update workspace.json', async () => {
        await cypressProjectGenerator(tree, {
          name: 'my-app-e2e',
          project: 'my-dir-my-app',
          directory: 'my-dir',
          linter: Linter.EsLint,
          standaloneConfig: false,
        });
        const projectConfig = readJson(tree, 'workspace.json').projects[
          'my-dir-my-app-e2e'
        ];

        expect(projectConfig).toBeDefined();
        expect(projectConfig.architect).toMatchSnapshot();
      });
    });

    describe('--linter', () => {
      describe('eslint', () => {
        it('should add eslint-plugin-cypress', async () => {
          await cypressProjectGenerator(tree, {
            name: 'my-app-e2e',
            project: 'my-app',
            linter: Linter.EsLint,
            standaloneConfig: false,
          });
          const packageJson = readJson(tree, 'package.json');
          expect(
            packageJson.devDependencies['eslint-plugin-cypress']
          ).toBeTruthy();

          const eslintrcJson = readJson(tree, 'apps/my-app-e2e/.eslintrc.json');
          expect(eslintrcJson).toMatchSnapshot();
        });
      });
    });

    describe('project with directory in its name', () => {
      beforeEach(async () => {
        await cypressProjectGenerator(tree, {
          name: 'my-dir/my-app-e2e',
          project: 'my-dir-my-app',
          linter: Linter.EsLint,
          standaloneConfig: false,
        });
      });

      it('should update workspace.json', async () => {
        const projectConfig = readJson(tree, 'workspace.json').projects[
          'my-dir-my-app-e2e'
        ];

        expect(projectConfig).toBeDefined();
        expect(projectConfig.architect).toMatchSnapshot();
      });

      it('should update nx.json', async () => {
        const project = readProjectConfiguration(tree, 'my-dir-my-app-e2e');
        expect(project.tags).toEqual([]);
        expect(project.implicitDependencies).toEqual(['my-dir-my-app']);
      });

      it('should set right path names in `cypress.json`', async () => {
        const cypressConfig = tree.read(
          'apps/my-dir/my-app-e2e/cypress.json',
          'utf-8'
        );

        expect(cypressConfig).toMatchSnapshot();
      });
    });
  });
});
