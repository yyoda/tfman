import { detectChanges } from '../../lib/ops/change-detector.mjs';
import { selectTargets } from '../../lib/ops/target-selector.mjs';
import { parseCommand } from '../../lib/ops/command-parser.mjs';

export async function run({ commentBody, baseSha, headSha }, dependencies = {}) {
  const {
    _detectChanges = detectChanges,
    _selectTargets = selectTargets,
    _parseCommand = parseCommand,
  } = dependencies;

  const parsed = _parseCommand(commentBody);
  if (!parsed) {
    return {
      command: 'error',
      targets: [],
      message: 'Not a valid command.',
      done: true,
    };
  }

  if (parsed.command === 'help') {
     return {
       command: parsed.command,
       targets: [],
       message: parsed.message,
       done: true,
     };
  }

  const { command, targets } = parsed;
  let targetDirs = [];

  try {
    if (targets.length > 0) {
      targetDirs = await _selectTargets(targets.join(' '));
    } else {
      targetDirs = await _detectChanges(baseSha, headSha);
    }

    if (targetDirs.length === 0) {
      return {
        command: 'error',
        targets: [],
        message: 'No Terraform directories matched the criteria.',
        done: true,
      };
    }

    return {
      command,
      targets: targetDirs,
      message: '',
      done: false,
    };

  } catch (error) {
    return {
      command: 'error',
      targets: [],
      message: error.message,
      done: true,
    };
  }
}
