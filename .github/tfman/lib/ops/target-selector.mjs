
/**
 * Resolves a list of target paths against the dependency graph.
 * @param {string[]} targets - List of target paths.
 * @param {Object} depsData - The dependency graph data.
 * @returns {{includeList: Array<{path: string, providers: string[]}>, failedTargets: string[]}}
 */
export function resolveTargets(targets, depsData) {
  const dirsMap = new Map();
  for (const d of (depsData.dirs || [])) {
    assertSafeRootPath(d.path);
    dirsMap.set(d.path, d.providers || []);
  }

  const includeList = [];
  const failedTargets = [];
  const seen = new Set();

  for (const t of targets) {
    if (typeof t !== 'string') assertSafeRootPath(t);
    const normalized = t.replace(/^\.\//, '').replace(/\/+$/, '');
    assertSafeRootPath(normalized);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (dirsMap.has(normalized)) {
      includeList.push({
        path: normalized,
        providers: dirsMap.get(normalized)
      });
    } else {
      failedTargets.push(t);
    }
  }

  return { includeList, failedTargets };
}

import { join } from 'node:path';
import { getWorkspaceRoot, loadJson, assertSafeRootPath } from '../utils.mjs';

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
