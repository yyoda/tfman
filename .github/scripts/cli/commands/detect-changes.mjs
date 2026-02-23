import { join } from 'node:path';
import { runCommand, getWorkspaceRoot, loadJson } from '../../lib/utils.mjs';

export async function runGitDiff(baseSha, headSha, root) {
  try {
    const { stdout } = await runCommand(`git diff --name-only ${baseSha} ${headSha}`, { cwd: root });
    return stdout.split('\n').filter(Boolean);
  } catch (error) {
    throw new Error(`Error running git diff: ${error.message}`);
  }
}

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

export async function run(options) {
  const { base, head } = options;
  if (!base || !head) {
    throw new Error('Missing required arguments: base, head');
  }

  const root = await getWorkspaceRoot();
  const changedFiles = await runGitDiff(base, head, root);
  const depsFile = join(root, '.tfdeps.json');
  const depsData = await loadJson(depsFile);

  return calculateExecutionPaths(changedFiles, depsData);
}
