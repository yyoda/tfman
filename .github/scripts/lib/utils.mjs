import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * Checks if a file or directory exists.
 ...
 */
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
 * @param {object} [options] - Options for spawn.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    // If second argument is options object (legacy support or simpler calls)
    if (!Array.isArray(args) && typeof args === 'object') {
      options = args;
      args = [];
    }

    // Default shell: false for security. If command is a full shell string,
    // caller must explicitly opt-in or split it manually (but prefer splitting).
    const spawnOptions = { shell: false, ...options };

    // Handle case where legacy implementation passed a full string command
    // and shell: true was implicit/default.
    // If we receive a command with spaces and no args, and shell is NOT explicitly true,
    // we should try to be helpful but safe. 
    // Ideally, callers should be updated. For this refactor, we enforce shell: false default.

    // If logic above is too strict for existing callers that do `runCommand('git rev-parse ...')`
    // we can perform a simple split if args is empty.
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
      stdoutChunks.length > 0 ? Buffer.concat(stdoutChunks).toString('utf-8').trim() : '';
      stderrChunks.length > 0 ? Buffer.concat(stderrChunks).toString('utf-8').trim() : '';

      const stdout = stdoutChunks.length > 0 ? Buffer.concat(stdoutChunks).toString('utf-8').trim() : '';
      const stderr = stderrChunks.length > 0 ? Buffer.concat(stderrChunks).toString('utf-8').trim() : '';

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
