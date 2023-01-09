import { runCommand } from '../tasks-runner/run-command';
import type { NxArgs } from '../utils/command-line-utils';
import { splitArgsIntoNxArgsAndOverrides } from '../utils/command-line-utils';
import { projectHasTarget } from '../utils/project-graph-utils';
import { connectToNxCloudIfExplicitlyAsked } from './connect';
import { performance } from 'perf_hooks';
import * as minimatch from 'minimatch';
import { ProjectGraph, ProjectGraphProjectNode } from '../config/project-graph';
import { createProjectGraphAsync } from '../project-graph/project-graph';
import { TargetDependencyConfig } from '../config/workspace-json-project-json';
import { readNxJson } from '../config/configuration';
import { output } from '../utils/output';
import { findMatchingProjects } from '../utils/find-matching-projects';

export async function runMany(
  args: { [k: string]: any },
  extraTargetDependencies: Record<
    string,
    (TargetDependencyConfig | string)[]
  > = {},
  extraOptions = { excludeTaskDependencies: false, loadDotEnvFiles: true } as {
    excludeTaskDependencies: boolean;
    loadDotEnvFiles: boolean;
  }
) {
  performance.mark('command-execution-begins');
  const nxJson = readNxJson();
  const { nxArgs, overrides } = splitArgsIntoNxArgsAndOverrides(
    args,
    'run-many',
    { printWarnings: true },
    nxJson
  );
  if (nxArgs.verbose) {
    process.env.NX_VERBOSE_LOGGING = 'true';
  }

  await connectToNxCloudIfExplicitlyAsked(nxArgs);

  const projectGraph = await createProjectGraphAsync({ exitOnError: true });
  const projects = projectsToRun(nxArgs, projectGraph);

  await runCommand(
    projects,
    projectGraph,
    { nxJson },
    nxArgs,
    overrides,
    null,
    extraTargetDependencies,
    extraOptions
  );
}

export function projectsToRun(
  nxArgs: NxArgs,
  projectGraph: ProjectGraph
): ProjectGraphProjectNode[] {
  const selectedProjects = new Map<string, ProjectGraphProjectNode>();
  const validProjects = runnableForTarget(projectGraph.nodes, nxArgs.targets);
  const invalidProjects: string[] = [];

  // --all is default now, if --projects is provided, it'll override the --all
  if (nxArgs.all && nxArgs.projects.length === 0) {
    for (const projectName of validProjects) {
      selectedProjects.set(projectName, projectGraph.nodes[projectName]);
    }
  } else {
    const allProjectNames = Object.keys(projectGraph.nodes);
    const matchingProjects = findMatchingProjects(
      nxArgs.projects,
      allProjectNames,
      new Set(allProjectNames)
    );
    for (const project of matchingProjects) {
      if (!validProjects.has(project)) {
        invalidProjects.push(project);
      } else {
        selectedProjects.set(project, projectGraph.nodes[project]);
      }
    }

    if (invalidProjects.length > 0) {
      output.warn({
        title: `the following do not have configuration for "${nxArgs.target}"`,
        bodyLines: invalidProjects.map((name) => `- ${name}`),
      });
    }
  }

  if (selectedProjects.size === 0) {
    throw new Error(`No projects found for project patterns`);
  }

  const excludedProjects = findMatchingProjects(
    nxArgs.exclude ?? [],
    Array.from(selectedProjects.keys()),
    new Set(selectedProjects.keys())
  );

  for (const excludedProject of excludedProjects) {
    const project = selectedProjects.has(excludedProject);

    if (project) {
      selectedProjects.delete(excludedProject);
    }
  }

  return Array.from(selectedProjects.values());
}

function runnableForTarget(
  projects: Record<string, ProjectGraphProjectNode>,
  targets: string[]
): Set<string> {
  const runnable = new Set<string>();
  for (let projectName in projects) {
    const project = projects[projectName];
    if (targets.find((target) => projectHasTarget(project, target))) {
      runnable.add(projectName);
    }
  }
  return runnable;
}
