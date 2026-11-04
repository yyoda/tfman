/*
 * When base advanced after divergence, a two-dot diff leaked unrelated files
 * into PR scope. Three-dot diff matches GitHub's "Files changed" semantics.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { fileURLToPath } from 'node:url';

import { runGitDiff, normalizeRepoIdentity, getBaseBranchLag, baseBranchLagMessage } from '../../lib/git.mjs';
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

describe('runGitDiff path handling', () => {
  let repoDir;
  let mainSha;
  let renameSha;
  let featureSha;
  const specialPath = ' envs/dev/日本語 ファイル.tf';

  before(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'tfman-git-paths-'));
    await runCommand('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
    await runCommand('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    await runCommand('git', ['config', 'core.quotePath', 'true'], { cwd: repoDir });
    await mkdir(join(repoDir, 'envs/dev'), { recursive: true });
    await writeFile(join(repoDir, 'envs/dev/main.tf'), '# Dev environment\n');
    await runCommand('git', ['add', 'envs/dev/main.tf'], { cwd: repoDir });
    await runCommand('git', ['commit', '-q', '-m', 'Add dev environment'], { cwd: repoDir });
    mainSha = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();

    await runCommand('git', ['checkout', '-q', '-b', 'feature'], { cwd: repoDir });
    await mkdir(join(repoDir, 'envs/prod'), { recursive: true });
    await runCommand('git', ['mv', 'envs/dev/main.tf', 'envs/prod/main.tf'], { cwd: repoDir });
    await runCommand('git', ['commit', '-q', '-m', 'Move dev to prod'], { cwd: repoDir });
    renameSha = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();

    await mkdir(join(repoDir, 'envs/dev'), { recursive: true });
    await mkdir(join(repoDir, ' envs/dev'), { recursive: true });
    await writeFile(join(repoDir, specialPath), '# Special filename\n');
    await runCommand('git', ['add', specialPath], { cwd: repoDir });
    await runCommand('git', ['commit', '-q', '-m', 'Add special filename'], { cwd: repoDir });
    featureSha = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
  });

  after(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('reports both source and destination paths for a rename', async () => {
    assert.deepStrictEqual((await runGitDiff(mainSha, renameSha, repoDir)).sort(), [
      'envs/dev/main.tf',
      'envs/prod/main.tf',
    ]);
  });

  it('preserves non-ASCII characters and leading spaces without quoting paths', async () => {
    assert.deepStrictEqual(await runGitDiff(renameSha, featureSha, repoDir), [specialPath]);
  });
});

describe('normalizeRepoIdentity', () => {
  for (const url of [
    'https://github.com/ORG/REPO.git',
    'git@github.com:org/repo.git',
    'ssh://git@github.com/org/repo',
    'github.com/org/repo',
    'git::https://github.com/org/repo.git//modules/x?ref=v1',
    'ssh://git@github.com:22/org/repo',
    'https://user:token@github.com/org/repo.git',
    'git::ssh://git@github.com:22/org/repo.git//modules/x?ref=v1',
  ]) {
    it(`normalizes ${url}`, () => {
      assert.strictEqual(normalizeRepoIdentity(url), 'github.com/org/repo');
    });
  }
  for (const url of [null, '', 'repo', 'github.com/repo', 'https://github.com/org']) {
    it(`rejects ${url}`, () => assert.strictEqual(normalizeRepoIdentity(url), null));
  }
});

describe('getBaseBranchLag', () => {
  let repoDir;
  let initial;
  let head;
  let merged;
  const git = (...args) => runCommand('git', args, { cwd: repoDir });

  before(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'tfman-ancestry-'));
    await git('init', '-q', '-b', 'base');
    await git('config', 'user.name', 'Test User');
    await git('config', 'user.email', 'test@example.com');
    await git('commit', '--allow-empty', '-qm', 'Initial');
    initial = (await git('rev-parse', 'HEAD')).stdout;
    await git('checkout', '-qb', 'feature');
    await git('commit', '--allow-empty', '-qm', 'Feature');
    head = (await git('rev-parse', 'HEAD')).stdout;
    await git('checkout', '-q', 'base');
    await git('commit', '--allow-empty', '-qm', 'Base one');
    await git('commit', '--allow-empty', '-qm', 'Base two');
    const tip = (await git('rev-parse', 'HEAD')).stdout;
    for (const name of ['main', 'release/1.x']) {
      await git('update-ref', `refs/remotes/origin/${name}`, tip);
    }
    // A similarly named local branch must not shadow the fully qualified ref.
    await git('branch', 'origin/main', head);
    await git('checkout', '-q', 'feature');
    await git('merge', '--no-ff', '-qm', 'Merge base', 'base');
    merged = (await git('rev-parse', 'HEAD')).stdout;
  });

  after(async () => {
    if (repoDir) await rm(repoDir, { recursive: true, force: true });
  });

  it('accepts a head containing the base tip', async () => {
    assert.deepStrictEqual(await getBaseBranchLag('main', 'base', repoDir), { upToDate: true, behindBy: 0 });
  });
  for (const name of ['main', 'release/1.x']) {
    it(`counts missing base commits for ${name}`, async () => {
      for (const sha of [head, initial]) {
        assert.deepStrictEqual(await getBaseBranchLag(name, sha, repoDir), { upToDate: false, behindBy: 2 });
      }
    });
  }
  it('accepts a merge commit containing base', async () => {
    assert.deepStrictEqual(await getBaseBranchLag('main', merged, repoDir), { upToDate: true, behindBy: 0 });
  });
  it('rejects unknown base and head refs', async () => {
    await assert.rejects(getBaseBranchLag('missing', head, repoDir), /Could not check base branch ancestry/);
    await assert.rejects(getBaseBranchLag('main', 'missing', repoDir), /Could not check base branch ancestry/);
  });
  it('rejects empty and non-string base names', async () => {
    for (const name of ['', ' ', null, undefined, 1]) {
      await assert.rejects(getBaseBranchLag(name, head, repoDir), /non-empty string/);
    }
  });
  it('fails closed when git cannot be started in the working directory', async () => {
    await assert.rejects(getBaseBranchLag('main', head, join(repoDir, 'missing')), /Could not check base branch ancestry/);
  });
  it('runs the real CLI silently on success and exits 1 with guidance when behind', async () => {
    const cli = fileURLToPath(new URL('../../cli/index.mjs', import.meta.url));
    const invoke = sha => runCommand(process.execPath, [cli, 'check-base-ancestry', '--base-ref', 'release/1.x', '--head-sha', sha, '--root', repoDir], { cwd: repoDir });
    assert.deepStrictEqual(await invoke(merged), { stdout: '', stderr: '' });
    await assert.rejects(invoke(head), error => {
      assert.strictEqual(error.code, 1);
      assert.strictEqual(error.stderr, `❌ ${baseBranchLagMessage('release/1.x', 2)}`);
      return true;
    });
  });
});
