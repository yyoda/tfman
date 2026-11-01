import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectChanges } from '../../../lib/ops/change-detector.mjs';
import { runCommand } from '../../../lib/utils.mjs';

const dirs = ['envs/hoge/dev', 'envs/hoge/stage', 'envs/hoge/prod', 'envs/hoge/dev/aoai', 'other']
  .map(path => ({ path, providers: ['aws'] }));
const files = [
  { path: 'envs/hoge/hoge.json', usedIn: ['envs/hoge/*'] },
  { path: 'officeIPs.json', usedIn: ['*'] }
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tfman-declared-inputs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => runCommand('git', args, { cwd: root });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Test User']);
  await git(['config', 'user.email', 'test@example.com']);
  for (const dir of dirs) {
    await mkdir(join(root, dir.path), { recursive: true });
    await writeFile(join(root, dir.path, 'main.tf'), '# Test root\n');
  }
  await writeFile(join(root, '.tfdeps.json'), JSON.stringify({ dirs, files }));
  await writeFile(join(root, '.tfdepsextra.json'), JSON.stringify({ files }));
  await writeFile(join(root, 'envs/hoge/hoge.json'), '{"value":1}\n');
  await writeFile(join(root, 'officeIPs.json'), '[]\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'Initial inputs']);
  const base = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  return { root, git, base };
}

describe('detectChanges declared inputs with real git', () => {
  const cases = [
    ['modified declared file selects immediate consumers', async ({ root }) => {
      await writeFile(join(root, 'envs/hoge/hoge.json'), '{"value":2}\n');
    }, dirs.slice(0, 3)],
    ['deleted declared file selects immediate consumers', async ({ root }) => {
      await rm(join(root, 'envs/hoge/hoge.json'));
    }, dirs.slice(0, 3)],
    ['renamed declared file selects consumers through the old endpoint', async ({ git }) => {
      await git(['mv', 'envs/hoge/hoge.json', 'envs/hoge/hoge2.json']);
    }, dirs.slice(0, 3)],
    ['modified officeIPs selects every root including nested roots', async ({ root }) => {
      await writeFile(join(root, 'officeIPs.json'), '["192.0.2.1"]\n');
    }, dirs],
    ...['.tfdeps.json', '.tfdepsextra.json'].map(path => [
      `changes only to ${path} select no roots`, async ({ root }) => {
        await writeFile(join(root, path), JSON.stringify({ dirs, files }, null, 2) + '\n');
      }, []
    ]),
    ['unrelated file selects no roots', async ({ root }) => {
      await writeFile(join(root, 'README.md'), '# Unrelated\n');
    }, []]
  ];

  for (const [name, change, expected] of cases) {
    it(name, async t => {
      const repo = await fixture(t);
      await change(repo);
      await repo.git(['add', '-A']);
      await repo.git(['commit', '-q', '-m', 'Change input']);
      const head = (await repo.git(['rev-parse', 'HEAD'])).stdout.trim();
      assert.deepStrictEqual(await detectChanges(repo.base, head, null, repo.root), expected);
    });
  }

  it('operate-command emits completed error JSON and exits zero for malformed file declarations', async t => {
    const { root, base } = await fixture(t);
    await writeFile(join(root, '.tfdeps.json'), JSON.stringify({
      dirs, files: [{ path: '../x', usedIn: ['*'] }]
    }));
    await assert.rejects(detectChanges(base, base, null, root), /Invalid file dependency pattern/);
    const cli = fileURLToPath(new URL('../../../cli/index.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      cli, 'operate-command', '--root', root, '--comment-body', '$terraform plan',
      '--base-sha', base, '--head-sha', base
    ], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr, '');
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      command: 'error', targetDirs: [], tfTargets: [],
      message: 'Invalid file dependency pattern: "../x"', done: true
    });
  });
});
