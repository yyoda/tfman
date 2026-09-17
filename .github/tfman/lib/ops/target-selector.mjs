
/**
 * Resolves a list of target paths against the dependency graph.
 * @param {string[]} targets - List of target paths.
 * @param {Object} depsData - The dependency graph data.
 * @returns {{includeList: Array<{path: string, providers: string[]}>, failedTargets: string[]}}
 */
export function resolveTargets(targets, depsData) {
  const dirsMap = new Map();
  for (const d of (depsData.dirs || [])) {
    if (d.path) {
      dirsMap.set(d.path, d.providers || []);
    }
  }

  const includeList = [];
  const failedTargets = [];

  for (const t of targets) {
    if (dirsMap.has(t)) {
      includeList.push({
        path: t,
        providers: dirsMap.get(t)
      });
    } else {
      // Try stripping trailing slash
      const tStripped = t.replace(/\/$/, '');
      if (dirsMap.has(tStripped)) {
        includeList.push({
          path: tStripped,
          providers: dirsMap.get(tStripped)
        });
      } else {
        failedTargets.push(t);
      }
    }
  }

  return { includeList, failedTargets };
}

import { join } from 'node:path';
import { getWorkspaceRoot, loadJson } from '../utils.mjs';

export async function selectTargets(targetsInput) {
  if (!targetsInput) {
    throw new Error('Missing required argument: targets');
  }

  const root = await getWorkspaceRoot();
  const targets = targetsInput.split(/\s+/).filter(Boolean);
  const depsFile = join(root, '.tfdeps.json');
  const depsData = await loadJson(depsFile);
  const { includeList, failedTargets } = resolveTargets(targets, depsData);

  if (failedTargets.length > 0) {
    throw new Error(`The following targets were not found in .tfdeps.json: ${failedTargets.join(', ')}`);
  }

  return includeList;
}
