function getHelpMessage() {
  return `
### :robot: Terraform Bot Usage

- \`$terraform apply [targets...] [-target=<resource>...]\`: Run \`terraform apply\`
- \`$terraform plan [targets...] [-target=<resource>...]\`: Run \`terraform plan\`
- \`$terraform help\`: Show this help message.

**Targets:**
- List of directories to apply changes to.
- Targets must match Terraform root paths in .tfdeps.json (dirs[].path, relative to the repo root).
- If **no targets** are provided, the bot detects changes based on the PR diff.

**-target (Terraform resource targeting):**
- Restrict plan/apply to specific Terraform resources.
- Accepts standard Terraform resource addresses (e.g., \`aws_instance.example\`, \`module.frontend\`).
- Both \`-target=<resource>\` and \`-target <resource>\` (space-separated) forms are supported.
- Multiple \`-target\` flags can be specified.

**Examples:**
- \`$terraform apply\`: Apply all changes in the PR.
- \`$terraform plan dev/frontend\`: Plan changes in \`dev/frontend\`.
- \`$terraform apply dev/backend dev/db\`: Apply for multiple paths.
- \`$terraform apply -target=aws_instance.web\`: Apply only \`aws_instance.web\`.
- \`$terraform apply -target aws_instance.web\`: Same as above (space-separated form).
- \`$terraform plan dev/frontend -target=module.vpc -target=aws_subnet.main\`: Plan with resource targeting.
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
      targetDirs: [],
      tfTargets: [],
      message: getHelpMessage(),
    };
  } else {
    return null;
  }

  const targetDirs = [];
  const tfTargets = [];
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];

    let resourceAddr = null;
    if (arg.startsWith('-target=')) {
      resourceAddr = arg.slice('-target='.length);
    } else if (arg === '-target') {
      i++;
      if (i >= args.length) {
        return {
          command: 'error',
          targetDirs: [],
          tfTargets: [],
          message: '-target requires a resource address (e.g., -target=aws_instance.web or -target aws_instance.web).'
        };
      }
      resourceAddr = args[i];
    }

    if (resourceAddr !== null) {
      if (!/^[\w.\-\[\]]+$/.test(resourceAddr) || /\.\./.test(resourceAddr)) {
        return {
          command: 'error',
          targetDirs: [],
          tfTargets: [],
          message: `Invalid -target resource address: "${resourceAddr}". Only alphanumeric characters, "-", ".", "_", "[", and "]" are allowed. Directory traversal ".." is invalid.`
        };
      }
      tfTargets.push(resourceAddr);
      continue;
    }

    if (!/^[\w\-\/\.]+$/.test(arg) || /\.\./.test(arg)) {
      return {
        command: 'error',
        targetDirs: [],
        tfTargets: [],
        message: `Invalid target path provided: "${arg}". Only alphanumeric characters, "-", "/", and "." are allowed. Directory traversal ".." is invalid.`
      };
    }
    targetDirs.push(arg);
  }

  return { command, targetDirs, tfTargets };
}
