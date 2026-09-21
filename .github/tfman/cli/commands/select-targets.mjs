import { selectTargets as defaultSelectTargets } from '../../lib/ops/target-selector.mjs';
import { requireArgs } from '../../lib/utils.mjs';
import { writeFile } from 'node:fs/promises';
import { createMatrix } from '../../lib/matrix.mjs';

export async function run(args, dependencies = {}) {
  const {
    selectTargets = defaultSelectTargets,
    saveJson = async (path, data) => writeFile(path, JSON.stringify(data, null, 2))
  } = dependencies;

  requireArgs(args, ['targets']);
  const { targets } = args;

  const result = await selectTargets(targets, args.root);

  if (args.output) await saveJson(args.output, createMatrix(result));

  return result;
}
