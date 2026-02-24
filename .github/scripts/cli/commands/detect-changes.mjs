import { detectChanges } from '../../lib/ops/change-detector.mjs';

export async function run(options) {
  const { base, head } = options;
  if (!base || !head) {
    throw new Error('Missing required arguments: base, head');
  }

  return detectChanges(base, head);
}
