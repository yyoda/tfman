import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../../../lib/utils.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../cli/commands/check-base-ancestry.mjs';
import { baseBranchLagMessage, baseBranchUnverifiedMessage } from '../../../lib/git.mjs';

describe('check-base-ancestry', () => {
  const args = { 'base-ref': 'release/1.x', 'head-sha': 'head', root: '/workspace' };
  it('resolves without output when up to date', async () => {
    assert.equal(await run(args, { _checkBaseBranch: async (...actual) => {
      assert.deepEqual(actual, ['release/1.x', 'head', '/workspace']);
      return { status: 'current' };
    } }), undefined);
  });
  it('throws the stale guidance', async () => {
    await assert.rejects(run(args, { _checkBaseBranch: async () => ({ status: 'stale', behindBy: 2 }) }),
      { message: baseBranchLagMessage('release/1.x', 2) });
  });
  it('requires both arguments', async () => {
    for (const input of [{}, { 'base-ref': 'base' }, { 'head-sha': 'head' }, { ...args, 'base-ref': '' }]) {
      await assert.rejects(run(input), /Missing required arguments/);
    }
  });
  it('reports lookup failures as could-not-verify, with details only on stderr', async () => {
    const logged = [];
    const original = console.error;
    console.error = (...parts) => logged.push(parts.join(' '));
    try {
      await assert.rejects(
        run(args, { _checkBaseBranch: async () => ({ status: 'unverified', detail: 'Lookup failed' }) }),
        error => {
          assert.equal(error.message, baseBranchUnverifiedMessage('release/1.x'));
          assert.doesNotMatch(error.message, /Lookup failed|commits? behind/);
          return true;
        },
      );
    } finally {
      console.error = original;
    }
    assert.deepEqual(logged, ['Lookup failed']);
  });
});

it('runs the real ancestry CLI for current, stale and unverified heads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tfman-check-ancestry-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  });
  const git = (...args) => runCommand('git', args, { cwd: root });
  await git('init', '-q', '-b', 'release/1.x');
  await git('config', 'user.name', 'Test User');
  await git('config', 'user.email', 'test@example.com');
  await git('commit', '--allow-empty', '-qm', 'Initial');
  const head = (await git('rev-parse', 'HEAD')).stdout;
  await git('commit', '--allow-empty', '-qm', 'Advance base');
  const tip = (await git('rev-parse', 'HEAD')).stdout;
  const remote = join(root, 'remote.git');
  await git('clone', '--bare', root, remote);
  await git('remote', 'add', 'origin', remote);
  const cli = fileURLToPath(new URL('../../../cli/index.mjs', import.meta.url));
  const invoke = (base, sha) => runCommand(process.execPath,
    [cli, 'check-base-ancestry', '--base-ref', base, '--head-sha', sha, '--root', root], { cwd: root });
  assert.deepEqual(await invoke('release/1.x', tip), { stdout: '', stderr: '' });
  await assert.rejects(invoke('release/1.x', head), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(error.stderr, `❌ ${baseBranchLagMessage('release/1.x', 1)}`);
    return true;
  });
  await assert.rejects(invoke('missing', head), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /Could not verify base branch freshness/);
    assert.ok(error.stderr.includes(`❌ ${baseBranchUnverifiedMessage('missing')}`));
    return true;
  });
});
