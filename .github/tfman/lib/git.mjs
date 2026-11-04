import { runCommand } from './utils.mjs';
import { logger } from './logger.mjs';

/**
 * Checks whether the PR head contains the fetched base branch tip.
 * @param {string} baseRef - Base branch name.
 * @param {string} headSha - PR head commit SHA.
 * @param {string} root - Repository working directory.
 * @returns {Promise<{upToDate: boolean, behindBy: number}>}
 */
export async function getBaseBranchLag(baseRef, headSha, root) {
  if (typeof baseRef !== 'string' || !baseRef.trim()) {
    throw new Error('Base branch name must be a non-empty string.');
  }
  const baseTip = `refs/remotes/origin/${baseRef}`;
  try {
    await runCommand('git', ['merge-base', '--is-ancestor', baseTip, headSha], { cwd: root });
    return { upToDate: true, behindBy: 0 };
  } catch (error) {
    if (error.code !== 1) {
      throw new Error(`Could not check base branch ancestry: ${error.message}`);
    }
  }
  try {
    const { stdout } = await runCommand('git', ['rev-list', '--count', `${headSha}..${baseTip}`], { cwd: root });
    return { upToDate: false, behindBy: Number(stdout) };
  } catch (error) {
    throw new Error(`Could not count commits behind the base branch: ${error.message}`);
  }
}

/** Builds the shared apply rejection message for a stale PR branch. */
export function baseBranchLagMessage(baseRef, behindBy) {
  return `This PR branch is ${behindBy} ${behindBy === 1 ? 'commit' : 'commits'} behind \`${baseRef}\`.\n\n`
    + 'Apply runs against the PR head only, so applying now could revert changes already merged into the base.\n\n'
    + `Update the branch using GitHub's "Update branch" button or by merging \`${baseRef}\` into it, `
    + 're-check the refreshed plan, then comment `$terraform apply` again.';
}

/**
 * Runs git diff to find changed files between two commits.
 *
 * Uses three-dot diff (`base...head`), which diffs against the merge-base of
 * the two commits — the same semantics as GitHub's "Files changed" tab. This
 * ensures only files changed on the head branch since it diverged from base
 * are reported, even if base has advanced further in the meantime.
 * Reports both source and destination paths for renames, without quoting paths.
 * @param {string} baseSha - The base commit SHA.
 * @param {string} headSha - The head commit SHA.
 * @param {string} root - The root directory of the repository.
 * @returns {Promise<string[]>} - A list of changed files.
 */
export async function runGitDiff(baseSha, headSha, root) {
  try {
    const { stdout } = await runCommand('git', ['diff', '--name-only', '-z', '--no-renames', `${baseSha}...${headSha}`], { cwd: root, trimOutput: false });
    return stdout.split('\0').filter(Boolean);
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
    const { stdout } = await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: root });
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

/** Normalize a Git URL to its lowercase host/owner/repository identity. */
export function normalizeRepoIdentity(url) {
  if (typeof url !== 'string') return null;
  let normalized = url.trim().replace(/^git::/i, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      normalized = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return null;
    }
  } else {
    normalized = normalized.replace(/^[^/@]+@/, '')
      .replace(/^([^/:]+):(?=[^/])/, '$1/');
  }
  normalized = normalized.split('?')[0].split('//')[0].replace(/\.git$/i, '');
  const match = normalized.match(/^([^/\s:]+)\/([^/\s]+)\/([^/\s]+)$/);
  return match ? match.slice(1).join('/').toLowerCase() : null;
}

/** Return the identity of the origin remote, or null if unavailable. */
export async function getRepoIdentity(root) {
  try {
    const { stdout } = await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: root });
    return normalizeRepoIdentity(stdout);
  } catch (error) {
    logger.warning(`⚠️  Could not determine repository identity from git remote: ${error.message}`);
    return null;
  }
}
