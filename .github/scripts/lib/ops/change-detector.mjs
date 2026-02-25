
import { join } from 'node:path';
import { getWorkspaceRoot, loadJson } from '../utils.mjs';
import { runGitDiff } from '../git.mjs';

/**
 * Calculates which Terraform roots need execution based on changed files and dependency graph.
 * @param {string[]} changedFiles - List of changed files.
 * @param {Object} depsData - The dependency graph data.
 * @returns {Array<{path: string, providers: string[]}>} - List of roots to execute.
 */
export function calculateExecutionPaths(changedFiles, depsData) {
  const dirsData = depsData.dirs || [];
  const modulesData = depsData.modules || [];

  // Maps for quick lookup
  const rootProviders = new Map();
  const knownRoots = new Set();

  for (const item of dirsData) {
    if (item.path) {
      knownRoots.add(item.path);
      rootProviders.set(item.path, item.providers || []);
    }
  }

  // Module -> Set<ConsumerRoot>
  const moduleUsageMap = new Map();
  for (const m of modulesData) {
    if (m.source) {
      moduleUsageMap.set(m.source, new Set(m.usedIn || []));
    }
  }

  // Sort modules descending by length to match longest path first
  const sortedModules = Array.from(moduleUsageMap.keys()).sort((a, b) => b.length - a.length);

  const affectedRoots = new Set();
  const changedModules = new Set();

  // Identify changed roots and modules
  for (const file of changedFiles) {
    // Check if file is inside a known root
    let isRootChange = false;
    for (const root of knownRoots) {
      if (file.startsWith(root + '/')) {
        affectedRoots.add(root);
        isRootChange = true;
        break;
      }
    }

    if (isRootChange) continue;

    // Check if file is inside a known module
    for (const mod of sortedModules) {
      if (file.startsWith(mod + '/')) {
        changedModules.add(mod);
        break;
      }
    }
  }

  // Resolve module dependencies
  if (changedModules.size > 0) {
    for (const changedModule of changedModules) {
      const consumers = moduleUsageMap.get(changedModule);
      if (consumers) {
        for (const consumer of consumers) {
          if (!affectedRoots.has(consumer)) {
            affectedRoots.add(consumer);
          }
        }
      }
    }
  }

  return Array.from(affectedRoots).map(p => ({
    path: p,
    providers: rootProviders.get(p) || []
  }));
}

export async function detectChanges(base, head) {
  if (!base || !head) {
    throw new Error('Missing required arguments: base, head');
  }

  const root = await getWorkspaceRoot();
  const changedFiles = await runGitDiff(base, head, root);
  const depsFile = join(root, '.tfdeps.json');
  const depsData = await loadJson(depsFile);

  return calculateExecutionPaths(changedFiles, depsData);
}
