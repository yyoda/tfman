import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDependencyGraph, findTerraformRoots, resolveLocalModule } from '../../../lib/ops/deps-generator.mjs';

const modulesJson = JSON.stringify({ Modules: [
  { Key: '', Source: '', Dir: '.' },
  { Key: 'net', Source: '../../modules/net', Dir: '../../modules/net' }
] });
const provider = 'registry.terraform.io/hashicorp/aws';

async function analyze(t, { modules = modulesJson, manifest, lockfile = true, schema } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'tfman-deps-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, 'env/a');
  await mkdir(join(root, '.terraform'), { recursive: true });
  await writeFile(join(root, '.terraform-version'), '1.5.7\n');
  await mkdir(join(workspace, 'modules/net'), { recursive: true });
  if (lockfile) await writeFile(join(root, '.terraform.lock.hcl'), `provider "${provider}" {\n}\n`);
  if (manifest !== undefined) {
    await mkdir(join(root, '.terraform/modules'), { recursive: true });
    await writeFile(join(root, '.terraform/modules/modules.json'), manifest);
  }
  const { results, roots } = await generateDependencyGraph(workspace, new Set(), {
    getRepoIdentity: async () => 'github.com/org/tfman',
    runCommand: async (command, args, options) => {
      assert.equal(command, 'terraform');
      assert.equal(options.cwd, root);
      let response;
      if (args[0] === 'modules') {
        assert.deepEqual(args, ['modules', '-json']);
        response = modules;
      } else {
        assert.equal(lockfile, false);
        assert.deepEqual(args, ['providers', 'schema', '-json']);
        response = schema;
      }
      if (response instanceof Error) throw response;
      return { stdout: response };
    }
  });
  assert.deepEqual(roots, ['env/a']);
  assert.equal(results.length, 1);
  return results[0];
}

describe('resolveLocalModule', () => {
  const accepted = [
    'git::https://github.com/org/tfman.git//modules/vpc',
    'git::https://github.com/org/tfman//modules/vpc',
    'git::ssh://git@github.com/org/tfman.git//modules/vpc',
    'git::git@github.com:org/tfman.git//modules/vpc',
    'github.com/org/tfman//modules/vpc',
    '../../modules/vpc'
  ];
  const rejected = [
    'git::https://github.com/unrelated-owner/tfman.git//modules/vpc',
    'git::https://example.invalid/org/tfman.git//modules/vpc',
    'git::https://github.com/org/tfman-tools.git//modules/vpc',
    'git::https://github.com/org/xtfman.git//modules/vpc',
    'git::https://github.com/tfman/other.git//modules/vpc',
    'git::https://github.com/org/tfman.git//modules/vpc?ref=v1.2.0',
    'git::https://github.com/org/other.git//modules/vpc',
    'terraform-aws-modules/vpc/aws'
  ];

  for (const [sources, expected] of [[accepted, 'modules/vpc'], [rejected, null]]) {
    for (const source of sources) {
      it(`${expected === null ? 'rejects' : 'accepts'} ${source}`, async t => {
        const workspace = await mkdtemp(join(tmpdir(), 'tfman-deps-'));
        t.after(() => rm(workspace, { recursive: true, force: true }));
        const rootAbs = join(workspace, 'env/a');
        await mkdir(join(workspace, 'modules/vpc'), { recursive: true });
        await mkdir(join(rootAbs, '.terraform/modules/vpc'), { recursive: true });
        const dirPath = source === '../../modules/vpc' ? '' : '.terraform/modules/vpc';
        assert.equal(await resolveLocalModule(rootAbs, source, dirPath, workspace, 'github.com/org/tfman'), expected);
      });
    }
  }
});

describe('lib/ops/deps-generator', () => {
  it('excludes the workspace root while including nested roots', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'tfman-deps-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await mkdir(join(workspace, 'env/a/sub'), { recursive: true });
    for (const dir of ['', 'env/a', 'env/a/sub']) {
      await writeFile(join(workspace, dir, '.terraform-version'), '1.5.7\n');
    }
    assert.deepEqual(await findTerraformRoots(workspace, new Set()), ['env/a', 'env/a/sub']);
  });

  it('a. extracts modules and lockfile providers', async t => {
    const result = await analyze(t);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.modules, ['modules/net']);
    assert.deepEqual(result.providers, [provider]);
    assert.deepEqual(result.logs, []);
  });

  it('b. fails when the modules command fails without a manifest', async t => {
    const result = await analyze(t, { modules: new Error('unsupported command') });
    assert.equal(result.status, 'failure');
    assert.ok(result.logs.some(log => log.includes("'terraform modules' failed")));
  });

  it('c. falls back to the initialized modules manifest', async t => {
    const result = await analyze(t, { modules: new Error('Command failed: terraform\nTerraform has no command named "modules".'), manifest: modulesJson });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.modules, ['modules/net']);
    assert.ok(result.logs.some(log => log.includes("'terraform modules' unavailable") && log.includes('used .terraform/modules/modules.json')));
  });

  it('d. fails on invalid command JSON without falling back', async t => {
    const result = await analyze(t, { modules: 'invalid json', manifest: modulesJson });
    assert.equal(result.status, 'failure');
    assert.ok(result.logs.some(log => log.includes('JSON decode error')));
    assert.ok(result.logs.every(log => !log.includes('unavailable')));
  });

  it('e. fails when provider schema extraction fails', async t => {
    const result = await analyze(t, { lockfile: false, schema: new Error('schema failed') });
    assert.equal(result.status, 'failure');
    assert.ok(result.logs.some(log => log.includes('Failed to get providers schema')));
  });

  it('f. extracts providers from the schema without a lockfile', async t => {
    const result = await analyze(t, { lockfile: false, schema: JSON.stringify({ provider_schemas: { [provider]: {} } }) });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.providers, [provider]);
  });

  it('fails on invalid manifest JSON', async t => {
    const result = await analyze(t, { modules: new Error('Command failed: terraform\nTerraform has no command named "modules".'), manifest: 'invalid json' });
    assert.equal(result.status, 'failure');
    assert.ok(result.logs.some(log => log.includes('JSON decode error')));
  });
});

for (const [name, options] of [
  ['generic command failure with a manifest', { modules: new Error('Command failed: terraform\nInitialization required'), manifest: modulesJson }],
  ['missing modules array in command output', { modules: '{}' }],
  ['missing modules array in manifest', { modules: new Error('no command named "modules"'), manifest: '{}' }],
]) {
  it(`fails for ${name}`, async t => {
    const result = await analyze(t, options);
    assert.equal(result.status, 'failure');
    assert.ok(result.logs.some(log => log.startsWith('❌')));
    if (name.startsWith('missing')) assert.ok(result.logs.some(log => log.includes('missing modules array')));
    else assert.ok(result.logs.every(log => !log.includes('unavailable')));
  });
}

it('fails for the older Terraform usage message even with a manifest', async t => {
  const result = await analyze(t, {
    modules: new Error('Command failed: terraform\nUsage: terraform [global options] <subcommand> [args]'),
    manifest: modulesJson,
  });
  assert.equal(result.status, 'failure');
  assert.ok(result.logs.every(log => !log.includes('unavailable')));
});

it('fails when an invalid expression merely mentions the missing command message', async t => {
  const result = await analyze(t, {
    modules: new Error('Error: Invalid expression: no command named "modules" is not a valid expression'),
    manifest: modulesJson,
  });
  assert.equal(result.status, 'failure');
  assert.ok(result.logs.every(log => !log.includes('unavailable')));
});
