import { getBaseBranchLag, baseBranchLagMessage } from '../../lib/git.mjs';
import { requireArgs } from '../../lib/utils.mjs';

export async function run(args, dependencies = {}) {
  const { _getBaseBranchLag = getBaseBranchLag } = dependencies;
  requireArgs(args, ['base-ref', 'head-sha']);
  const { upToDate, behindBy } = await _getBaseBranchLag(args['base-ref'], args['head-sha'], args.root);
  if (!upToDate) {
    throw new Error(baseBranchLagMessage(args['base-ref'], behindBy));
  }
}
