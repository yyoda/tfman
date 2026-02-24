import { selectTargets } from '../../lib/ops/target-selector.mjs';

export async function run(options) {
  const { targets } = options;
  if (!targets) {
    throw new Error('Missing required argument: targets');
  }

  return selectTargets(targets);
}
