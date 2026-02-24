import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * Checks if a file or directory exists.
 * @param {string} path - The path to check.
 * @returns {Promise<boolean>} - True if the path exists, false otherwise.
 */
export async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, ...options });
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
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

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
  const { stdout } = await runCommand('git rev-parse --show-toplevel');
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
