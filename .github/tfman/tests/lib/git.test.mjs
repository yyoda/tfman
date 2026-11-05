/*
 * When base advanced after divergence, a two-dot diff leaked unrelated files
 * into PR scope. Three-dot diff matches GitHub's "Files changed" semantics.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { runGitDiff, normalizeRepoIdentity, checkBaseBranch, baseBranchLagMessage, baseBranchUnverifiedMessage } from '../../lib/git.mjs';
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

// Every fixture owns its remote and clone, and removes both after the test.
async function ancestryFixture(t, { base = 'base', behind = 2, merged = false, shallow = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tfman-ancestry-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  });
  const seed = join(root, 'seed');
  const remote = join(root, 'remote.git');
  const workspace = join(root, 'workspace');
  await mkdir(seed);
  const git = (cwd, ...args) => runCommand('git', args, { cwd });
  await git(seed, 'init', '-q', '-b', base);
  await git(seed, 'config', 'user.name', 'Test User');
  await git(seed, 'config', 'user.email', 'test@example.com');
  await git(seed, 'commit', '--allow-empty', '-qm', 'Initial');
  await git(seed, 'checkout', '-qb', 'feature');
  await git(seed, 'commit', '--allow-empty', '-qm', 'Feature');
  await git(seed, 'checkout', '-q', base);
  for (let i = 0; i < behind; i++) {
    await git(seed, 'commit', '--allow-empty', '-qm', `Base ${i}`);
  }
  await git(seed, 'checkout', '-q', 'feature');
  if (merged) await git(seed, 'merge', '--no-ff', '-qm', 'Merge base', base);
  const head = (await git(seed, 'rev-parse', 'HEAD')).stdout;
  await git(root, 'clone', '--bare', seed, remote);
  await git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  await git(root, 'clone', ...(shallow ? ['--depth', '1'] : []), pathToFileURL(remote).href, workspace);
  await git(workspace, 'checkout', '--detach', head);
  assert.strictEqual((await git(workspace, 'rev-parse', '--is-shallow-repository')).stdout, String(shallow));
  return { root, seed, remote, workspace, head, base, git };
}

describe('checkBaseBranch with real remotes', () => {
  for (const options of [
    { behind: 0 },
    { behind: 1 },
    { behind: 2 },
    { behind: 2, merged: true },
    { behind: 2, merged: true, shallow: false },
    { base: 'release/1.x', behind: 2 },
  ]) {
    it(`refreshes and completes history: ${JSON.stringify(options)}`, async t => {
      const f = await ancestryFixture(t, options);
      const result = await checkBaseBranch(f.base, f.head, f.workspace);
      assert.deepStrictEqual(result, options.merged || options.behind === 0
        ? { status: 'current' } : { status: 'stale', behindBy: options.behind });
      assert.strictEqual((await f.git(f.workspace, 'rev-parse', '--is-shallow-repository')).stdout, 'false');
    });
  }
  it('fails closed when the base branch is missing on the remote', async t => {
    const f = await ancestryFixture(t);
    assert.strictEqual((await checkBaseBranch('missing', f.head, f.workspace)).status, 'unverified');
  });
  it('never trusts a cached current ref when refreshing the remote fails', async t => {
    const f = await ancestryFixture(t, { behind: 0, shallow: false });
    assert.deepStrictEqual(await checkBaseBranch(f.base, f.head, f.workspace), { status: 'current' });
    await rm(f.remote, { recursive: true });
    await f.git(f.workspace, 'merge-base', '--is-ancestor', `refs/remotes/origin/${f.base}`, f.head);
    assert.strictEqual((await checkBaseBranch(f.base, f.head, f.workspace)).status, 'unverified');
  });
  for (const shallow of [true, false]) {
    it(`fails closed for an unavailable pinned SHA (shallow: ${shallow})`, async t => {
      const f = await ancestryFixture(t, { shallow });
      assert.strictEqual((await checkBaseBranch(f.base, 'a'.repeat(40), f.workspace)).status, 'unverified');
    });
  }
  it('observes the base advancing between setup and run', async t => {
    const f = await ancestryFixture(t, { behind: 0 });
    assert.deepStrictEqual(await checkBaseBranch(f.base, f.head, f.workspace), { status: 'current' });
    await f.git(f.seed, 'checkout', '-q', f.base);
    await f.git(f.seed, 'commit', '--allow-empty', '-qm', 'Advance after setup');
    await f.git(f.seed, 'push', f.remote, f.base);
    assert.deepStrictEqual(await checkBaseBranch(f.base, f.head, f.workspace), { status: 'stale', behindBy: 1 });
  });
});

describe('checkBaseBranch failure classification', () => {
  const error = code => Object.assign(new Error('Command failed'), { code });
  async function scripted(responses) {
    const calls = [];
    const result = await checkBaseBranch('base', 'head', '/workspace', { run: async (command, args, options) => {
      calls.push(args);
      assert.strictEqual(command, 'git');
      assert.deepStrictEqual(options, { cwd: '/workspace' });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.notStrictEqual(next, undefined, 'Unexpected command');
      return { stdout: next };
    } });
    assert.deepStrictEqual(responses, []);
    return { result, calls };
  }
  it('rejects empty and non-string inputs before running git', async () => {
    for (const value of ['', ' ', null, undefined, 1]) {
      for (const [base, head] of [[value, 'head'], ['base', value]]) {
        let calls = 0;
        const result = await checkBaseBranch(base, head, '/workspace', { run: async () => { calls++; } });
        assert.strictEqual(result.status, 'unverified');
        assert.strictEqual(calls, 0);
      }
    }
  });
  for (const responses of [
    ['unknown'], [error(128)],
    ['true', '', 'true'], ['true', '', 'unknown'], ['true', '', error(128)],
    ['false', error(128)], ['false', '', error(128)], ['false', '', error('1')],
    ['false', '', error(undefined)],
    ...['0', 'abc', '-1', '1.5', '9007199254740992', error(128)].map(count => ['false', '', error(1), count]),
  ]) {
    it(`returns unverified and stops at failure: ${responses.map(x => x instanceof Error ? `error(${x.code})` : x).join(', ')}`, async () => {
      const { result, calls } = await scripted([...responses]);
      assert.strictEqual(result.status, 'unverified');
      assert.ok(result.detail.length > 0);
      assert.strictEqual(calls.length, responses.length);
    });
  }
  it('only classifies stale after merge-base exits exactly 1 and the count is positive', async () => {
    const { result, calls } = await scripted(['false', '', error(1), '2']);
    assert.deepStrictEqual(result, { status: 'stale', behindBy: 2 });
    assert.deepStrictEqual(calls[1], ['fetch', '--no-tags', 'origin', '+refs/heads/base:refs/remotes/origin/base']);
    assert.deepStrictEqual(calls[2], ['merge-base', '--is-ancestor', 'refs/remotes/origin/base', 'head']);
    assert.deepStrictEqual(calls[3], ['rev-list', '--count', 'head..refs/remotes/origin/base']);
  });
});

describe('baseBranchLagMessage', () => {
  for (const count of [1, 2]) {
    it(`describes ${count} missing commits with recovery guidance`, () => {
      const message = baseBranchLagMessage('release/1.x', count);
      assert.ok(message.includes(`${count} ${count === 1 ? 'commit' : 'commits'} behind`));
      assert.match(message, /`release\/1.x`/);
      assert.match(message, /Update branch/);
    });
  }
});

describe('baseBranchUnverifiedMessage', () => {
  it('names the base and distinguishes unknown freshness from staleness', () => {
    const message = baseBranchUnverifiedMessage('release/1.x');
    assert.match(message, /freshness against `release\/1.x` could not be verified/);
    assert.match(message, /does not mean the branch is behind/);
    assert.match(message, /workflow run logs/);
    assert.match(message, /\$terraform apply/);
  });
  it('uses a fallback and never emits the output delimiter as a line', () => {
    for (const base of ['', ' ', null, undefined, 1]) {
      assert.match(baseBranchUnverifiedMessage(base), /against the base branch/);
    }
    assert.ok(!baseBranchUnverifiedMessage('base\nghadelim\nbranch').split('\n').includes('ghadelim'));
  });
});
