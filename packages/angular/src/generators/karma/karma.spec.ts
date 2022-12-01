import * as devkit from '@nrwl/devkit';
import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';
import { karmaGenerator } from './karma';
import { NxJsonConfiguration, readJson, updateJson } from '@nrwl/devkit';

describe('karma', () => {
  let tree: devkit.Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace({ layout: 'apps-libs' });
  });

  it('should do nothing when karma is already installed and karma.conf.js exists', () => {
    jest.spyOn(devkit, 'generateFiles');
    jest.spyOn(devkit, 'addDependenciesToPackageJson');
    devkit.updateJson(tree, 'package.json', (json) => {
      json.devDependencies = { karma: '~5.0.0' };
      return json;
    });
    tree.write('karma.conf.js', '');
    karmaGenerator(tree, {});

    expect(devkit.generateFiles).not.toHaveBeenCalled();
    expect(devkit.addDependenciesToPackageJson).not.toHaveBeenCalled();
  });

  it('should create karma.conf.js when karma is installed', () => {
    jest.spyOn(devkit, 'generateFiles');
    jest.spyOn(devkit, 'addDependenciesToPackageJson');
    devkit.updateJson(tree, 'package.json', (json) => {
      json.devDependencies = { karma: '~5.0.0' };
      return json;
    });

    karmaGenerator(tree, {});

    expect(devkit.generateFiles).toHaveBeenCalled();
    expect(devkit.addDependenciesToPackageJson).not.toHaveBeenCalled();
  });

  it('should add karma dependencies', () => {
    karmaGenerator(tree, {});

    const { devDependencies } = devkit.readJson(tree, 'package.json');
    expect(devDependencies['karma']).toBeDefined();
    expect(devDependencies['karma-chrome-launcher']).toBeDefined();
    expect(devDependencies['karma-coverage']).toBeDefined();
    expect(devDependencies['karma-jasmine']).toBeDefined();
    expect(devDependencies['karma-jasmine-html-reporter']).toBeDefined();
    expect(devDependencies['jasmine-core']).toBeDefined();
    expect(devDependencies['jasmine-spec-reporter']).toBeDefined();
    expect(devDependencies['@types/jasmine']).toBeDefined();
    expect(devDependencies['@types/node']).toBeDefined();
  });

  it('should add karma configuration', () => {
    karmaGenerator(tree, {});

    expect(tree.exists('karma.conf.js')).toBeTruthy();
  });

  it('should add inputs for test targets', () => {
    updateJson<NxJsonConfiguration>(tree, 'nx.json', (json) => {
      json.namedInputs ??= {};
      json.namedInputs.production = ['default', '^production'];
      return json;
    });
    karmaGenerator(tree, {});

    const nxJson = readJson<NxJsonConfiguration>(tree, 'nx.json');
    expect(nxJson.namedInputs.production).toContain(
      '!{projectRoot}/karma.conf.js'
    );
    expect(nxJson.namedInputs.production).toContain(
      '!{projectRoot}/tsconfig.spec.json'
    );
    expect(nxJson.namedInputs.production).toContain(
      '!{projectRoot}/**/*.spec.[jt]s'
    );
    expect(nxJson.targetDefaults.test).toEqual({
      inputs: ['default', '^production', '{workspaceRoot}/karma.conf.js'],
    });
  });
});
