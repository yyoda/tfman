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
    };
  }

  if (parsed.command === 'help') {
     return {
       command: parsed.command,
       targets: [],
       message: parsed.message
     };
  }

  const { command, targets } = parsed;
  let matrixParams = [];

  try {
    if (targets.length > 0) {
      matrixParams = await _selectTargets(targets.join(' '));
    } else {
      matrixParams = await _detectChanges(baseSha, headSha);
    }

    if (matrixParams.length === 0) {
      return {
        command: 'error',
        targets: [],
        message: 'No Terraform directories matched the criteria.',
      };
    }

    return {
      command,
      targets: matrixParams,
      message: '',
    };

  } catch (error) {
    return {
      command: 'error',
      targets: [],
      message: error.message,
    };
  }
}
