import { writeResult as defaultWriteResult } from '../../lib/ops/result-writer.mjs';
import { requireArgs } from '../../lib/utils.mjs';

export async function run(args, dependencies = {}) {
  const { writeResult = defaultWriteResult } = dependencies;
  requireArgs(args, ['path', 'command', 'outcome']);
  if (!['plan', 'apply'].includes(args.command)) {
    throw new Error('--command must be plan or apply');
  }
  const result = await writeResult({
    cwd: process.cwd(),
    path: args.path,
    command: args.command,
    outcome: args.outcome,
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
    githubOutput: process.env.GITHUB_OUTPUT,
  });
  return result;
}
