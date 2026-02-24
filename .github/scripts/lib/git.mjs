import { runCommand } from './utils.mjs';
import { logger } from './logger.mjs';

/**
 * Runs git diff to find changed files between two commits.
 * @param {string} baseSha - The base commit SHA.
 * @param {string} headSha - The head commit SHA.
 * @param {string} root - The root directory of the repository.
 * @returns {Promise<string[]>} - A list of changed files.
 */
export async function runGitDiff(baseSha, headSha, root) {
  try {
    const { stdout } = await runCommand(`git diff --name-only ${baseSha} ${headSha}`, { cwd: root });
    return stdout.split('\n').filter(Boolean);
  } catch (error) {
    throw new Error(`Error running git diff: ${error.message}`);
  }
}

/**
 * Determines the repository name from the git remote URL.
 * @param {string} root - The root directory of the repository.
 * @returns {Promise<string|null>} - The repository name or null if not found.
 */
export async function getRepoName(root) {
  try {
    const { stdout } = await runCommand('git remote get-url origin', { cwd: root });
    const url = stdout.trim();
    // Match the repo name from various git URL formats:
    // https://github.com/org/repo.git
    // git@github.com:org/repo.git
    const match = url.match(/\/([^/.]+)(\.git)?$/);
    return match ? match[1] : null;
  } catch (error) {
    logger.warning(`⚠️  Could not determine repository name from git remote: ${error.message}`);
    return null;
  }
}
