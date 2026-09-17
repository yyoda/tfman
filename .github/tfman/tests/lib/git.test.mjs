/*
 * When base advanced after divergence, a two-dot diff leaked unrelated files
 * into PR scope. Three-dot diff matches GitHub's "Files changed" semantics.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runGitDiff } from '../../lib/git.mjs';
import { runCommand } from '../../lib/utils.mjs';

describe('runGitDiff', () => {
  let repoDir;
  let mergeBase;
  let headSha;
  let baseSha;

  before(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'tfman-git-'));
    await runCommand('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
    await runCommand('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });

    await writeFile(join(repoDir, 'README.md'), '# Test repository\n');
    await writeFile(join(repoDir, '.tfdeps.json'), '{}\n');
    await runCommand('git', ['add', 'README.md', '.tfdeps.json'], { cwd: repoDir });
    await runCommand('git', ['commit', '-q', '-m', 'Initial commit'], { cwd: repoDir });
    mergeBase = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();

    await runCommand('git', ['checkout', '-q', '-b', 'feature'], { cwd: repoDir });
    await writeFile(join(repoDir, 'AGENTS.md'), '# Agent instructions\n');
    await runCommand('git', ['add', 'AGENTS.md'], { cwd: repoDir });
    await runCommand('git', ['commit', '-q', '-m', 'Add agent instructions'], { cwd: repoDir });
    headSha = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();

    await runCommand('git', ['checkout', '-q', 'main'], { cwd: repoDir });
    await writeFile(join(repoDir, '.tfdeps.json'), '{"updated": true}\n');
    await mkdir(join(repoDir, 'envs', 'dev'), { recursive: true });
    await writeFile(join(repoDir, 'envs', 'dev', 'main.tf'), '# Dev environment\n');
    await runCommand('git', ['add', '.tfdeps.json', 'envs/dev/main.tf'], { cwd: repoDir });
    await runCommand('git', ['commit', '-q', '-m', 'Advance main after divergence'], { cwd: repoDir });
    baseSha = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
  });

  after(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('excludes files that changed on base after the head branch diverged', async () => {
    assert.deepStrictEqual(await runGitDiff(baseSha, headSha, repoDir), ['AGENTS.md']);
  });

  it('returns no changes when head has not diverged from base', async () => {
    assert.deepStrictEqual(await runGitDiff(baseSha, mergeBase, repoDir), []);
  });

  it('throws a descriptive error on invalid refs', async () => {
    await assert.rejects(
      runGitDiff('nonexistent-ref', 'also-bad', repoDir),
      (error) => error instanceof Error && error.message.startsWith('Error running git diff')
    );
  });
});
