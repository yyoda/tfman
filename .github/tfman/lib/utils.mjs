import { spawn } from 'node:child_process';
import { readFile, access, appendFile } from 'node:fs/promises';
import { constants } from 'node:fs';

/** Checks if a file or directory exists. */
export async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a command.
 * @param {string} command - The command to run.
 * @param {string[]} [args] - Arguments for the command.
 * @param {object} [options] - Spawn options; trimOutput defaults to true.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    // If second argument is options object (legacy support or simpler calls)
    if (!Array.isArray(args) && typeof args === 'object') {
      options = args;
      args = [];
    }

    const { trimOutput = true, ...optionsForSpawn } = options;
    const spawnOptions = { shell: false, ...optionsForSpawn };

    // Preserve legacy whitespace-separated commands without invoking a shell.
    if (args.length === 0 && command.includes(' ') && !spawnOptions.shell) {
      const parts = command.split(/\s+/);
      command = parts[0];
      args = parts.slice(1);
    }

    const child = spawn(command, args, spawnOptions);
    const stdoutChunks = [];
    const stderrChunks = [];


    if (child.stdout) {
      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    }

    child.on('error', (error) => {
      reject(new Error(`Failed to start command: ${command}\n${error.message}`));
    });

    child.on('close', (code) => {
      const decode = chunks => {
        const text = Buffer.concat(chunks).toString('utf-8');
        return trimOutput ? text.trim() : text;
      };
      const stdout = decode(stdoutChunks);
      const stderr = decode(stderrChunks);

      if (code !== 0) {
        const error = new Error(`Command failed: ${command}\n${stderr}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function getWorkspaceRoot() {
  const { stdout } = await runCommand('git', ['rev-parse', '--show-toplevel']);
  return stdout;
}

export async function loadJson(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to decode JSON from ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validates that required keys exist in the args object.
 * @param {object} args - The arguments object.
 * @param {string[]} requiredKeys - List of keys that must be present.
 * @throws {Error} If any key is missing.
 */
export function requireArgs(args, requiredKeys) {
  const missing = requiredKeys.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.join(', ')}`);
  }
}

/** Append step outputs to $GITHUB_OUTPUT (or the given file). Multi-line values use heredoc syntax. */
export async function appendGithubOutput(entries, file = process.env.GITHUB_OUTPUT) {
  if (!file) return;
  const output = Object.entries(entries).map(([key, value]) => {
    const text = String(value ?? '');
    if (text.split(/\r?\n/).includes('ghadelim')) {
      throw new Error('GitHub output value contains the delimiter ghadelim');
    }
    return text.includes('\n')
      ? `${key}<<ghadelim\n${text}\nghadelim\n`
      : `${key}=${text}\n`;
  }).join('');
  await appendFile(file, output);
}
