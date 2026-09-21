import { writeOutputs } from '../../gh-scripts/write-outputs.mjs';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../gh-scripts/write-outputs.mjs', import.meta.url));

it('rejects malformed input and missing output configuration without writing outputs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tfman-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'output');
  for (const [mode, input] of [
    ['matrix', ''],
    ['matrix', 'not json'],
    ['matrix', '{}'],
    ['matrix', '[{"path":"../unsafe"}]'],
    ['command', '{"done":false}'],
    ['unknown', '[]'],
  ]) {
    const result = spawnSync(process.execPath, [script, mode], {
      input, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
  const missing = spawnSync(process.execPath, [script, 'matrix'], {
    input: '[]', encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /GITHUB_OUTPUT is required/);
});

it('appends ordered step outputs with multiline messages and boolean strings', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'operate-output-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const output = join(cwd, 'output');
  await writeFile(output, 'existing=value\n');
  const cases = [
    { command: 'help', targetDirs: [], tfTargets: [], message: 'first line\nEOF\nlast line\n', done: true },
    { command: 'plan', targetDirs: [{ path: 'env/x', providers: [] }], tfTargets: ['module.example'], message: '', done: false },
  ];
  let previous = 'existing=value\n';
  for (const expected of cases) {
    await writeOutputs('command', expected, output);
    const content = await readFile(output, 'utf8');
    assert.ok(content.startsWith(previous));
    const appended = content.slice(previous.length);
    const matrix = expected.done ? '' : JSON.stringify({ include: expected.targetDirs });
    assert.strictEqual(appended,
      `tf_targets_json=${JSON.stringify(expected.tfTargets)}\n` +
      `matrix=${matrix}\n` +
      `command=${expected.command}\n` +
      `done=${expected.done}\n` +
      (expected.message.includes('\n') ? `message<<ghadelim\n${expected.message}\nghadelim\n` : `message=${expected.message}\n`));
    if (expected.message.includes('\n')) {
      assert.strictEqual(appended.split('message<<ghadelim\n')[1].split('\nghadelim\n')[0], expected.message);
    }
    previous = content;
  }
});

it('runs through a symlink and preserves the JSON log and step outputs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tfman-linked-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const link = join(dir, 'adapter.mjs');
  const output = join(dir, 'output');
  await symlink(script, link);
  const result = spawnSync(process.execPath, [link, 'matrix'], {
    input: '[]', encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), []);
  assert.equal(await readFile(output, 'utf8'), 'matrix={"include":[]}\nhas-changes=false\n');
});

it('preserves UTF-8 messages split across stdin chunks', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tfman-utf8-output-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'output');
  const command = { command: 'help', done: true, targetDirs: [], tfTargets: [], message: '日本語' };
  const input = Buffer.from(JSON.stringify(command));
  const split = input.indexOf(Buffer.from('日')) + 1;
  const child = spawn(process.execPath, [script, 'command'], {
    env: { ...process.env, GITHUB_OUTPUT: output }, timeout: 5000,
  });
  const stdout = [];
  let stderr = '';
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => { stderr += chunk; });
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  child.stdin.write(input.subarray(0, split));
  await new Promise(resolve => setTimeout(resolve, 100));
  child.stdin.end(input.subarray(split));
  await completion;
  assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString('utf8')), command);
  assert.match(await readFile(output, 'utf8'), /message=日本語/);
});
