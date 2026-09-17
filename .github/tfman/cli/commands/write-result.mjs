import { writeResult as defaultWriteResult } from '../../lib/ops/result-writer.mjs';
import { logger as defaultLogger } from '../../lib/logger.mjs';
import { requireArgs } from '../../lib/utils.mjs';

export async function run(args, dependencies = {}) {
  const { writeResult = defaultWriteResult, logger = defaultLogger } = dependencies;
  requireArgs(args, ['path', 'command', 'outcome']);
  if (!['plan', 'apply'].includes(args.command)) {
    throw new Error('--command must be plan or apply');
  }
  const result = await writeResult({
    cwd: args.cwd ?? process.cwd(),
    path: args.path,
    command: args.command,
    outcome: args.outcome,
    summaryFile: args['summary-file'] ?? process.env.GITHUB_STEP_SUMMARY,
    githubOutput: args['github-output'] ?? process.env.GITHUB_OUTPUT,
  });
  logger.info(`Result written for ${args.path}: ${result.artifactName}`);
  return result;
}
