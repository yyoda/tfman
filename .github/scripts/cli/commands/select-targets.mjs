import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { getWorkspaceRoot, loadJson } from '../../lib/utils.mjs';
import { logger } from '../../lib/logger.mjs';

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

export async function selectFn(targetsInput) {
  if (!targetsInput) {
    throw new Error('Missing required argument: targetsInput');
  }
  
  const root = await getWorkspaceRoot();
  // Split by whitespace
  const targets = targetsInput.split(/\s+/).filter(Boolean);

  const depsFile = join(root, '.tfdeps.json');
  const depsData = await loadJson(depsFile);

  const { includeList, failedTargets } = resolveTargets(targets, depsData);

  if (failedTargets.length > 0) {
    throw new Error(`The following targets were not found in .tfdeps.json: ${failedTargets.join(', ')}`);
  }

  return includeList;
}

export async function run(options) {
  const { targets: targetsInput, output } = options;
  if (!targetsInput) {
    throw new Error('Missing required argument: --targets');
  }

  try {
    const includeList = await selectFn(targetsInput);

    const root = await getWorkspaceRoot();
    const outputPath = output || join(root, '.tfmatrix.json');

    const matrixJson = { include: includeList };
    await writeFile(outputPath, JSON.stringify(matrixJson));

    logger.info(`Matrix JSON written to ${outputPath}`);
  } catch (error) {
    console.log(`::error::${error.message}`);
    process.exit(1);
  }
}
