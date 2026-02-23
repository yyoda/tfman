import { writeFile } from 'node:fs/promises';
import { run as runDetectChanges } from './detect-changes.mjs';
import { run as runSelectTargets } from './select-targets.mjs';
import { logger } from '../../lib/logger.mjs';

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

export async function run({ commentBody, baseSha, headSha, output }, dependencies = {}) {
  const {
    _detectChanges = runDetectChanges,
    _selectTargets = runSelectTargets,
    _writeFile = writeFile,
  } = dependencies;

  const parsed = parseCommand(commentBody);
  if (!parsed) {
    return;
  }

  if (parsed.command === 'help') {
    logger.info('Help command detected.');
    await writeJson(output, {
      command: 'help',
      result_message: parsed.helpMsg,
    }, _writeFile);
    return;
  }

  const { command, targets } = parsed;
  let matrixParams = [];

  try {
    if (targets.length > 0) {
      // Since selectFn was usually called with a string of space-separated targets in the original logic:
      // "matrixParams = await selectFn(targets.join(' '));"
      // We keep that behavior but using the injected function.
      matrixParams = await _selectTargets({ targets: targets.join(' ') });
    } else {
      matrixParams = await _detectChanges({ base: baseSha, head: headSha });
    }

    if (matrixParams.length === 0) {
      await writeJson(output, {
        command: 'noop',
        result_message: 'No Terraform directories matched the criteria.',
      }, _writeFile);
      return;
    }

    // Determine target count for message
    const targetCount = matrixParams.length;
    const action = command === 'plan' ? 'Planning' : 'Applying';
    const message = `### ${action} ${targetCount} targets\n\n` + 
                    matrixParams.map(m => `- \`${m.path}\``).join('\n');

    await writeJson(output, {
      command: command,
      matrix: { include: matrixParams },
      result_message: message,
    }, _writeFile);

  } catch (error) {
    await writeJson(output, {
      command: 'error',
      result_message: `### Error Processing Request\n\n${error.message}`,
    }, _writeFile);
    process.exit(1);
  }
}

async function writeJson(filePath, data, _writeFile = writeFile) {
  const content = JSON.stringify(data, null, 2);
  if (filePath) {
    await _writeFile(filePath, content);
  } else {
    console.log(content);
  }
}
