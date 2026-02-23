import { join } from 'node:path';
import { getWorkspaceRoot, loadJson } from '../../lib/utils.mjs';

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

export async function run(options) {
  const { targets: targetsInput } = options;
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
