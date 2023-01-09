import {
  ExecutorContext,
  joinPathFragments,
  logger,
  parseTargetString,
  readTargetOptions,
  Tree,
} from '@nrwl/devkit';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import {
  BuildOptions,
  InlineConfig,
  mergeConfig,
  searchForWorkspaceRoot,
  ServerOptions,
  UserConfig,
} from 'vite';
import { ViteDevServerExecutorOptions } from '../executors/dev-server/schema';
import replaceFiles from '../../plugins/rollup-replace-files.plugin';
import { ViteBuildExecutorOptions } from '../executors/build/schema';

export async function getBuildAndSharedConfig(
  options:
    | (ViteDevServerExecutorOptions & ViteBuildExecutorOptions)
    | ViteBuildExecutorOptions,
  context: ExecutorContext
): Promise<InlineConfig> {
  const projectRoot =
    context.projectsConfigurations.projects[context.projectName].root;

  return mergeConfig({}, {
    mode: options.mode,
    root: projectRoot,
    base: options.base,
    configFile: normalizeViteConfigFilePath(projectRoot, options.configFile),
    plugins: [replaceFiles(options.fileReplacements)],
    build: getViteBuildOptions(
      options as ViteDevServerExecutorOptions & ViteBuildExecutorOptions,
      projectRoot
    ),
    optimizeDeps: { force: options.force },
  } as InlineConfig);
}

export function normalizeViteConfigFilePath(
  projectRoot: string,
  configFile?: string
): string {
  return configFile && existsSync(joinPathFragments(configFile))
    ? configFile
    : existsSync(joinPathFragments(`${projectRoot}/vite.config.ts`))
    ? joinPathFragments(`${projectRoot}/vite.config.ts`)
    : existsSync(joinPathFragments(`${projectRoot}/vite.config.js`))
    ? joinPathFragments(`${projectRoot}/vite.config.js`)
    : undefined;
}

export function getServerOptions(
  options: ViteDevServerExecutorOptions,
  context: ExecutorContext
): ServerOptions {
  const projectRoot =
    context.projectsConfigurations.projects[context.projectName].root;
  let serverOptions: ServerOptions & UserConfig = {};
  if (options.proxyConfig) {
    const proxyConfigPath = options.proxyConfig
      ? join(context.root, options.proxyConfig)
      : join(projectRoot, 'proxy.conf.json');

    if (existsSync(proxyConfigPath)) {
      logger.info(`Loading proxy configuration from: ${proxyConfigPath}`);
      serverOptions.proxy = require(proxyConfigPath);
      serverOptions.fs = {
        allow: [
          searchForWorkspaceRoot(joinPathFragments(projectRoot)),
          joinPathFragments(context.root, 'node_modules/vite'),
        ],
      };
    }
  }

  serverOptions = {
    ...serverOptions,
    host: options.host,
    port: options.port,
    https: options.https,
    hmr: options.hmr,
    open: options.open,
    cors: options.cors,
    logLevel: options.logLevel,
    clearScreen: options.clearScreen,
  };

  return serverOptions;
}

export function getBuildTargetOptions(
  buildTarget: string,
  context: ExecutorContext
) {
  const target = parseTargetString(buildTarget, context.projectGraph);
  return readTargetOptions(target, context);
}

export function getViteBuildOptions(
  options: ViteDevServerExecutorOptions & ViteBuildExecutorOptions,
  projectRoot: string
): BuildOptions {
  let buildOptions: BuildOptions & UserConfig = {
    outDir: relative(projectRoot, options.outputPath),
    emptyOutDir: true,
    reportCompressedSize: true,
    cssCodeSplit: true,
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  };

  buildOptions = {
    ...buildOptions,
    sourcemap: options.sourcemap,
    minify: options.minify,
    manifest: options.manifest,
    ssrManifest: options.ssrManifest,
    ssr: options.ssr,
    logLevel: options.logLevel,
  };

  return buildOptions;
}
