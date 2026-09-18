import { detectChanges } from '../../lib/ops/change-detector.mjs';
import { selectTargets } from '../../lib/ops/target-selector.mjs';
import { parseCommand } from '../../lib/ops/command-parser.mjs';
import { appendGithubOutput, requireArgs } from '../../lib/utils.mjs';

export async function run(args, dependencies = {}) {
  const result = await operate(args, dependencies);
  if (args['github-output']) {
    const matrix = !result.done && result.targetDirs.length > 0
      ? JSON.stringify({ include: result.targetDirs }) : '';
    await appendGithubOutput({
      tf_targets_json: JSON.stringify(result.tfTargets),
      matrix,
      command: result.command,
      done: String(result.done),
      message: result.message,
    }, args['github-output']);
  }
  return result;
}

// Completed commands never schedule roots or pass resource targets downstream.
function completedResult(message, command = 'error') {
  return { command, targetDirs: [], tfTargets: [], message, done: true };
}

async function operate(args, dependencies) {
  const {
    _detectChanges = detectChanges,
    _selectTargets = selectTargets,
    _parseCommand = parseCommand,
  } = dependencies;

  requireArgs(args, ['comment-body', 'base-sha', 'head-sha']);
  const { 'comment-body': commentBody, 'base-sha': baseSha, 'head-sha': headSha } = args;

  const parsed = _parseCommand(commentBody);
  if (!parsed) {
    return completedResult('Not a valid command.');
  }

  // If the parser explicitly returned an error (e.g. invalid target path),
  // do not fall back to auto-detection.
  if (parsed.command === 'error') {
    return completedResult(parsed.message || 'Invalid command.');
  }

  if (parsed.command === 'help') {
    return completedResult(parsed.message, 'help');
  }

  const { command, targetDirs: parsedTargetDirs = [], tfTargets = [] } = parsed;
  if (args.roles !== undefined && command === 'apply') {
    let roles;
    try {
      roles = JSON.parse(args.roles);
    } catch {
      roles = [];
    }
    if (!Array.isArray(roles) || !roles.includes('applier')) {
      return completedResult(
        `User ${args.actor} does not have permission to apply. Required role: applier.`, 'apply'
      );
    }
  }
  let targetDirs = [];

  try {
    if (parsedTargetDirs.length > 0) {
      targetDirs = await _selectTargets(parsedTargetDirs.join(' '));
    } else {
      targetDirs = await _detectChanges(baseSha, headSha);
    }

    if (targetDirs.length === 0) {
      return completedResult('No Terraform directories matched the criteria.');
    }

    return {
      command,
      targetDirs,
      tfTargets,
      message: '',
      done: false,
    };

  } catch (error) {
    return completedResult(error.message);
  }
}
