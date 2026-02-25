import { selectTargets as defaultSelectTargets } from '../../lib/ops/target-selector.mjs';
import { requireArgs } from '../../lib/utils.mjs';
import { writeFile } from 'node:fs/promises';

export async function run(args, dependencies = {}) {
  const { 
    selectTargets = defaultSelectTargets,
    saveJson = async (path, data) => writeFile(path, JSON.stringify(data, null, 2))
  } = dependencies;

  requireArgs(args, ['targets']);
  const { targets, output } = args;

  const result = await selectTargets(targets);

  if (output) {
      await saveJson(output, { include: result });
  }

  return result;
}
