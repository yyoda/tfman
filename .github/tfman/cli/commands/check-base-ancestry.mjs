import { checkBaseBranch, baseBranchLagMessage, baseBranchUnverifiedMessage } from '../../lib/git.mjs';
import { requireArgs } from '../../lib/utils.mjs';

/** Refreshes the base and fails unless the pinned head contains its latest tip. */
export async function run(args, { _checkBaseBranch = checkBaseBranch } = {}) {
  requireArgs(args, ['base-ref', 'head-sha']);
  const result = await _checkBaseBranch(args['base-ref'], args['head-sha'], args.root);
  if (result.status === 'stale') {
    throw new Error(baseBranchLagMessage(args['base-ref'], result.behindBy));
  }
  if (result.status === 'unverified') {
    console.error(result.detail);
    throw new Error(baseBranchUnverifiedMessage(args['base-ref']));
  }
}
