import { detectChanges as defaultDetectChanges } from '../../lib/ops/change-detector.mjs';
import { loadJson as defaultLoadJson, requireArgs } from '../../lib/utils.mjs';
import { writeFile } from 'node:fs/promises';
import { createMatrix } from '../../lib/matrix.mjs';

export async function run(args, dependencies = {}) {
  const {
    detectChanges = defaultDetectChanges,
    loadJson = defaultLoadJson,
    saveJson = async (path, data) => writeFile(path, JSON.stringify(data, null, 2))
  } = dependencies;

  requireArgs(args, ['base', 'head']);
  const { base, head, 'deps-file': depsFile } = args;

  let dependencyGraph = null;
  if (depsFile === true) throw new Error('--deps-file requires a path');
  if (depsFile !== undefined) {
    dependencyGraph = await loadJson(depsFile);
  }

  const result = await detectChanges(base, head, dependencyGraph, args.root);

  if (args.output) await saveJson(args.output, createMatrix(result));

  return result;
}
