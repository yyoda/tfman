import { run as runDetectChanges } from './detect-changes.mjs';
import { run as runSelectTargets } from './select-targets.mjs';

function getHelpMessage() {
  return `
### :robot: Terraform Apply Bot Usage

- \`/apply [targets...]\`: Run \`terraform apply\`
- \`/plan [targets...]\`: Run \`terraform plan\`
- \`/help\`: Show this help message.

**Targets:**
- List of directories to apply changes to.
- If **no targets** are provided, the bot detects changes based on the PR diff.

**Examples:**
- \`/apply\`: Apply all changes in the PR.
- \`/plan dev/frontend\`: Plan changes in \`dev/frontend\`.
- \`/apply dev/backend dev/db\`: Apply for multiple paths.
`.trim();
}

export function parseCommand(commentBody) {
  if (!commentBody) return null;

  const trimmed = commentBody.trim();
  const firstLine = trimmed.split(/\r?\n/)[0];

  // Regex to capture arguments, handling quotes
  const regex = /"([^"]+)"|'([^']+)'|([^\s]+)/g;
  const args = [];
  let match;

  while ((match = regex.exec(firstLine)) !== null) {
    args.push(match[1] || match[2] || match[3]);
  }

  if (args.length === 0) return null;

  const cmdToken = args[0];
  let command = null;

  if (cmdToken === '/apply') {
    command = 'apply';
  } else if (cmdToken === '/plan') {
    command = 'plan';
  } else if (cmdToken === '/help') {
    return {
      command: 'help',
      targets: [],
      message: getHelpMessage(),
    };
  } else {
    return null;
  }

  const targets = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    targets.push(arg);
  }

  return { command, targets };
}

export async function run({ commentBody, baseSha, headSha }, dependencies = {}) {
  const {
    _detectChanges = runDetectChanges,
    _selectTargets = runSelectTargets,
  } = dependencies;

  const parsed = parseCommand(commentBody);
  if (!parsed) {
    return {
      command: 'skipped',
      targets: [],
      message: 'Not a valid command.',
    };
  }

  if (parsed.command === 'help') {
     return {
       command: 'help',
       targets: [],
       message: parsed.message
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
        command: 'skipped',
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
      command: 'skipped',
      targets: [],
      message: error.message,
    };
  }
}
