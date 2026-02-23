import { run as runDetectChanges } from './detect-changes.mjs';
import { run as runSelectTargets } from './select-targets.mjs';

export function parseCommand(commentBody) {
  if (!commentBody) return null;

  const trimmed = commentBody.trim();
  const firstLine = trimmed.split(/\r?\n/)[0];

  if (!firstLine.startsWith('/apply')) {
    return null;
  }

  const regex = /"([^"]+)"|'([^']+)'|([^\s]+)/g;
  const args = [];
  let match;

  while ((match = regex.exec(firstLine)) !== null) {
    args.push(match[1] || match[2] || match[3]);
  }

  const targets = [];
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      return {
        command: 'help',
        helpMsg: getHelpMessage(),
      };
    }
    if (arg === '--dry-run') {
      dryRun = true;
    } else {
      targets.push(arg);
    }
  }

  return {
    command: dryRun ? 'plan' : 'apply',
    targets,
  };
}

function getHelpMessage() {
  return `
### :robot: Terraform Apply Bot Usage

\`/apply [targets...] [options]\`

**Options:**
- \`--dry-run\`: Run \`terraform plan\` instead of \`terraform apply\`.
- \`-h\`, \`--help\`: Show this help message.

**Targets:**
- List of directories to apply changes to.
- If **no targets** are provided, the bot detects changes based on the PR diff.

**Examples:**
- \`/apply\`: Apply all changes in the PR.
- \`/apply dev/frontend\`: Apply changes in \`dev/frontend\` only.
- \`/apply --dry-run\`: Plan all changes in the PR.
`.trim();
}

export async function run({ commentBody, baseSha, headSha }, dependencies = {}) {
  const {
    _detectChanges = runDetectChanges,
    _selectTargets = runSelectTargets,
  } = dependencies;

  const parsed = parseCommand(commentBody);
  if (!parsed) {
    return null;
  }

  if (parsed.command === 'help') {
    return {
      command: 'help',
      result_message: parsed.helpMsg,
    };
  }

  const { command, targets } = parsed;
  let matrixParams = [];

  try {
    if (targets.length > 0) {
      matrixParams = await _selectTargets({ targets: targets.join(' ') });
    } else {
      matrixParams = await _detectChanges({ base: baseSha, head: headSha });
    }

    if (matrixParams.length === 0) {
      return {
        command: 'noop',
        result_message: 'No Terraform directories matched the criteria.',
      };
    }

    const targetCount = matrixParams.length;
    const action = command === 'plan' ? 'Planning' : 'Applying';
    const message = `### ${action} ${targetCount} targets\n\n` + 
                    matrixParams.map(m => `- \`${m.path}\``).join('\n');

    return {
      command: command,
      matrix: { include: matrixParams },
      result_message: message,
    };

  } catch (error) {
    return {
      command: 'error',
      result_message: `### Error Processing Request\n\n${error.message}`,
    };
  }
}
