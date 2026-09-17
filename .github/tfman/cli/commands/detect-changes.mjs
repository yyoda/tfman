import { detectChanges as defaultDetectChanges } from '../../lib/ops/change-detector.mjs';
import { loadJson as defaultLoadJson, requireArgs } from '../../lib/utils.mjs';
import { writeFile } from 'node:fs/promises';

export async function run(args, dependencies = {}) {
  const {
    detectChanges = defaultDetectChanges,
    loadJson = defaultLoadJson,
    saveJson = async (path, data) => writeFile(path, JSON.stringify(data, null, 2))
  } = dependencies;

  requireArgs(args, ['base', 'head']);
  const { base, head, 'deps-file': depsFile, output } = args;

  let dependencyGraph = null;
  if (depsFile) {
      try {
          dependencyGraph = await loadJson(depsFile);
      } catch (error) {
          console.warn(`Warning: Could not load dependency graph from ${depsFile}`, error.message);
      }
  }

  const result = await detectChanges(base, head, dependencyGraph);

  if (output) {
      await saveJson(output, { include: result });
  }

  return result;
}
