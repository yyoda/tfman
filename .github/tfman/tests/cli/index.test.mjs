import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../../cli/index.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

function runCli(args, options = {}) {
  return execute(process.execPath, [cli, ...args], { cwd: repoRoot, timeout: 30_000, ...options });
}

async function writeShim(dir, script, shebang = '#!/usr/bin/env bash') {
  const path = join(dir, 'terraform');
  await writeFile(path, `${shebang}\n${script}`);
  await chmod(path, 0o755);
}

describe('CLI entry point', () => {
  it('rejects generate-deps when terraform fails without writing a graph', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-missing-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const bin = join(dir, 'bin');
    await mkdir(bin);
    await writeShim(bin, 'exit 1\n', '#!/bin/bash');

    await assert.rejects(runCli(['generate-deps', '--root', dir], {
      env: { ...process.env, PATH: bin },
    }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /'terraform' command not found or failed to run/);
      return true;
    });
    await assert.rejects(readFile(join(dir, '.tfdeps.json')), { code: 'ENOENT' });
  });

  it('rejects generate-deps analysis failures without writing a graph', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-analysis-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const root = join(dir, 'env/a');
    const bin = join(dir, 'bin');
    await mkdir(join(root, '.terraform'), { recursive: true });
    await mkdir(bin);
    await writeFile(join(root, '.terraform-version'), '1.5.7');
    await writeFile(join(root, '.terraform.lock.hcl'), 'provider "registry.terraform.io/hashicorp/null" {}');
    await writeShim(bin, `case "$1 $2" in
  '-version ') printf '%s\\n' 'Terraform v1.5.7' ;;
  'modules -json') printf '%s\\n' 'not json' ;;
  *) exit 1 ;;
esac
`);

    await assert.rejects(runCli(['generate-deps', '--root', dir], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Analysis failed for 1 roots/);
      return true;
    });
    await assert.rejects(readFile(join(dir, '.tfdeps.json')), { code: 'ENOENT' });
  });

  it('generates a dependency graph at the default or requested output path', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-generate-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const root = join(dir, 'env/a');
    const bin = join(dir, 'bin');
    await mkdir(join(root, '.terraform'), { recursive: true });
    await mkdir(join(dir, 'modules/m'), { recursive: true });
    await mkdir(bin);
    await writeFile(join(root, '.terraform-version'), '1.5.7');
    await writeFile(join(root, '.terraform.lock.hcl'), 'provider "registry.terraform.io/hashicorp/null" {}');
    await writeShim(bin, `case "$1 $2" in
  '-version ') printf '%s\\n' 'Terraform v1.5.7' ;;
  'modules -json') printf '%s\\n' '{"Modules":[{"Key":"","Source":"","Dir":"."},{"Key":"m","Source":"../../modules/m","Dir":"../../modules/m"}]}' ;;
  *) exit 1 ;;
esac
`);
    const options = { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
    const expected = {
      dirs: [{ path: 'env/a', providers: ['registry.terraform.io/hashicorp/null'] }],
      modules: [{ source: 'modules/m', usedIn: ['env/a'] }],
    };
    const defaultOutput = join(dir, '.tfdeps.json');

    await runCli(['generate-deps', '--root', dir], options);
    assert.deepEqual(JSON.parse(await readFile(defaultOutput, 'utf8')), expected);
    await rm(defaultOutput);

    const output = join(dir, 'other.json');
    await runCli(['generate-deps', '--root', dir, '--output', output], options);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), expected);
    await assert.rejects(readFile(defaultOutput), { code: 'ENOENT' });
  });

  it('detects no changes between identical refs on stdout or in an output matrix', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-detect-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const args = ['detect-changes', '--base', 'HEAD', '--head', 'HEAD', '--deps-file', '.tfdeps.json'];
    const { stdout } = await runCli(args);
    assert.deepEqual(JSON.parse(stdout), []);

    const output = join(dir, 'matrix.json');
    const saved = await runCli([...args, '--output', output]);
    assert.equal(saved.stdout, '');
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { include: [] });
  });

  it('returns unauthorized apply as a completed command and writes GitHub outputs', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-apply-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'github-output');
    const { stdout } = await runCli([
      'operate-command', '--comment-body', '$terraform apply',
      '--base-sha', 'HEAD', '--head-sha', 'HEAD', '--roles', '[]', '--actor', 'someone',
      '--github-output', output,
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.command, 'apply');
    assert.equal(result.done, true);
    assert.deepEqual(result.targetDirs, []);
    assert.match(result.message, /does not have permission to apply/);
    const saved = await readFile(output, 'utf8');
    assert.match(saved, /^command=apply$/m);
    assert.match(saved, /^done=true$/m);
  });

  it('reports GitHub output write failures with a non-zero exit and no stack trace', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-output-failure-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await assert.rejects(runCli([
      'operate-command', '--comment-body', '$terraform apply',
      '--base-sha', 'HEAD', '--head-sha', 'HEAD', '--roles', '[]', '--actor', 'someone',
      '--github-output', join(dir, 'missing/github-output'),
    ]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /^❌/);
      assert.doesNotMatch(error.stderr, /\n\s+at /);
      return true;
    });
  });

  for (const command of ['', 'unknown', 'constructor']) {
    it(`rejects ${command || 'missing command'} with a non-zero exit`, async () => {
      await assert.rejects(runCli(command ? [command] : []), error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, command ? /Unknown command:/ : /Usage:/);
        return true;
      });
    });
  }

  it('prints selected roots to stdout or writes a matrix to the requested file', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const graph = JSON.parse(await readFile(join(repoRoot, '.tfdeps.json'), 'utf8'));
    const root = graph.dirs[0];
    const targets = `${root.path}/ ./${root.path}`;
    const expected = [{ path: root.path, providers: root.providers || [] }];

    const { stdout } = await runCli(['select-targets', '--targets', targets]);
    assert.deepEqual(JSON.parse(stdout), expected);

    const output = join(dir, 'matrix.json');
    const saved = await runCli(['select-targets', '--targets', targets, '--output', output]);
    assert.equal(saved.stdout, '');
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { include: expected });
  });

  it('reports command validation errors without a stack trace', async () => {
    await assert.rejects(runCli(['detect-changes']), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Missing required arguments: base, head/);
      assert.doesNotMatch(error.stderr, /\n\s+at /);
      return true;
    });
  });

  it('returns help without resolving refs and writes GitHub outputs', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-help-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'github-output');
    const { stdout } = await runCli([
      'operate-command', '--comment-body', '$terraform help',
      '--base-sha', 'unused-base', '--head-sha', 'unused-head', '--github-output', output,
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.command, 'help');
    assert.equal(result.done, true);
    assert.deepEqual(result.targetDirs, []);
    assert.match(await readFile(output, 'utf8'), /command=help\ndone=true\n/);
  });

  it('writes result artifacts without printing the internal return value', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-cli-result-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const summary = join(dir, 'summary');
    const output = join(dir, 'output');
    await writeFile(join(dir, 'plan.txt'), 'No changes.');
    const { stdout } = await runCli([
      'write-result', '--path', 'env/test', '--command', 'plan', '--outcome', 'success',
    ], {
      cwd: dir,
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output },
    });
    assert.equal(stdout, '');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'info.json'), 'utf8')), {
      path: 'env/test', outcome: 'success',
    });
    assert.match(await readFile(summary, 'utf8'), /No changes\./);
    assert.match(await readFile(output, 'utf8'), /artifact_name=plan-env-test-/);
  });
});
