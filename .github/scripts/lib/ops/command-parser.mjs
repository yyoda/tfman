function getHelpMessage() {
  return `
### :robot: Terraform Bot Usage

- \`$terraform apply [targets...]\`: Run \`terraform apply\`
- \`$terraform plan [targets...]\`: Run \`terraform plan\`
- \`$terraform help\`: Show this help message.

**Targets:**
- List of directories to apply changes to.
- If **no targets** are provided, the bot detects changes based on the PR diff.

**Examples:**
- \`$terraform apply\`: Apply all changes in the PR.
- \`$terraform plan dev/frontend\`: Plan changes in \`dev/frontend\`.
- \`$terraform apply dev/backend dev/db\`: Apply for multiple paths.
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

  if (args.length < 2 || args[0] !== '$terraform') return null;

  const cmdToken = args[1];
  let command = null;

  if (cmdToken === 'apply') {
    command = 'apply';
  } else if (cmdToken === 'plan') {
    command = 'plan';
  } else if (cmdToken === 'help') {
    return {
      command: 'help',
      targets: [],
      message: getHelpMessage(),
    };
  } else {
    return null;
  }

  const targets = [];
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    // Security: Validate target argument to prevent command injection or path traversal
    // Allow alphanumeric, forward slash, hyphen, underscore
    if (!/^[\w\-\/]+$/.test(arg)) {
      // Log warning or just skip/throw? 
      // For safety, let's skip invalid targets but continue parsing valid ones, 
      // or fail the whole command. Failing is safer to notify user.
      return {
        command: 'error',
        targets: [],
        message: `Invalid target path provided: "${arg}". Only alphanumeric characters, "-", and "/" are allowed.`
      };
    }
    targets.push(arg);
  }

  return { command, targets };
}
