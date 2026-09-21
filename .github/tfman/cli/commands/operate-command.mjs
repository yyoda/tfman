import { detectChanges } from '../../lib/ops/change-detector.mjs';
import { selectTargets } from '../../lib/ops/target-selector.mjs';
import { parseCommand } from '../../lib/ops/command-parser.mjs';
import { requireArgs } from '../../lib/utils.mjs';

// Completed commands never schedule roots or pass resource targets downstream.
function completedResult(message, command = 'error') {
  return { command, targetDirs: [], tfTargets: [], message, done: true };
}

export async function run(args, dependencies = {}) {
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
      targetDirs = await _selectTargets(parsedTargetDirs.join(' '), args.root);
    } else {
      targetDirs = await _detectChanges(baseSha, headSha, null, args.root);
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
