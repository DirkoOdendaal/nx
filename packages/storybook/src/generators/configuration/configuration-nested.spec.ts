import { NxJsonConfiguration, Tree, updateJson, writeJson } from '@nrwl/devkit';
import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';

import configurationGenerator from './configuration';
import * as rootProjectConfiguration from './test-configs/root-project-configuration.json';
import * as workspaceConfiguration from './test-configs/root-workspace-configuration.json';

describe('@nrwl/storybook:configuration for workspaces with Root project', () => {
  describe('basic functionalities', () => {
    let tree: Tree;

    beforeEach(async () => {
      tree = createTreeWithEmptyWorkspace({ layout: 'apps-libs' });
      updateJson<NxJsonConfiguration>(tree, 'nx.json', (json) => {
        json.namedInputs = {
          production: ['default'],
        };
        return json;
      });

      writeJson(tree, 'project.json', rootProjectConfiguration);
      writeJson(tree, 'tsconfig.json', {
        extends: './tsconfig.base.json',
        compilerOptions: {
          jsx: 'react-jsx',
          allowJs: false,
          esModuleInterop: false,
          allowSyntheticDefaultImports: true,
          forceConsistentCasingInFileNames: true,
          isolatedModules: true,
          lib: ['DOM', 'DOM.Iterable', 'ESNext'],
          module: 'ESNext',
          moduleResolution: 'Node',
          noEmit: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          strict: true,
          target: 'ESNext',
          types: ['vite/client', 'vitest'],
          useDefineForClassFields: true,
          noImplicitOverride: true,
          noPropertyAccessFromIndexSignature: true,
          noImplicitReturns: true,
          noFallthroughCasesInSwitch: true,
        },
        files: [],
        include: [],
        references: [
          {
            path: './tsconfig.app.json',
          },
          {
            path: './tsconfig.spec.json',
          },
          {
            path: './.storybook/tsconfig.json',
          },
        ],
      });
      writeJson(tree, 'workspace.json', workspaceConfiguration);
      writeJson(tree, 'package.json', {
        devDependencies: {
          '@storybook/addon-essentials': '~6.2.9',
          '@storybook/react': '~6.2.9',
        },
      });
    });

    it('should generate files for root app', async () => {
      await configurationGenerator(tree, {
        name: 'web',
        uiFramework: '@storybook/react',
        standaloneConfig: false,
      });

      expect(tree.exists('.storybook/main.js')).toBeTruthy();
      expect(tree.exists('.storybook/main.root.js')).toBeTruthy();
      expect(tree.exists('.storybook/tsconfig.json')).toBeTruthy();
      expect(tree.exists('.storybook/preview.js')).toBeTruthy();
    });

    it('should generate Storybook files for nested first - then for root', async () => {
      writeJson(tree, 'apps/reapp/tsconfig.json', {});

      await configurationGenerator(tree, {
        name: 'reapp',
        uiFramework: '@storybook/react',
        tsConfiguration: true,
      });

      expect(tree.exists('.storybook/main.ts')).toBeFalsy();
      expect(tree.exists('.storybook/main.root.ts')).toBeTruthy();
      expect(tree.exists('.storybook/tsconfig.json')).toBeFalsy();
      expect(tree.exists('.storybook/preview.ts')).toBeFalsy();

      expect(tree.exists('apps/reapp/.storybook/main.ts')).toBeTruthy();
      expect(tree.exists('apps/reapp/.storybook/tsconfig.json')).toBeTruthy();
      expect(tree.exists('apps/reapp/.storybook/preview.ts')).toBeTruthy();

      await configurationGenerator(tree, {
        name: 'web',
        uiFramework: '@storybook/react',
      });

      expect(tree.exists('.storybook/main.ts')).toBeTruthy();
      expect(tree.exists('.storybook/tsconfig.json')).toBeTruthy();
      expect(tree.exists('.storybook/preview.ts')).toBeTruthy();

      expect(tree.read('.storybook/main.ts', 'utf-8')).toMatchSnapshot();
      expect(tree.read('.storybook/tsconfig.json', 'utf-8')).toMatchSnapshot();
      expect(tree.read('.storybook/preview.ts', 'utf-8')).toMatchSnapshot();
      expect(tree.read('.storybook/main.root.ts', 'utf-8')).toMatchSnapshot();
      expect(
        tree.read('apps/reapp/.storybook/main.ts', 'utf-8')
      ).toMatchSnapshot();
      expect(
        tree.read('apps/reapp/.storybook/tsconfig.json', 'utf-8')
      ).toMatchSnapshot();
      expect(
        tree.read('apps/reapp/.storybook/preview.ts', 'utf-8')
      ).toMatchSnapshot();
    });
  });
});
