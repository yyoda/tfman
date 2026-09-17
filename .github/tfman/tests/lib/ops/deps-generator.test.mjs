import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDependencyGraph } from '../../../lib/ops/deps-generator.mjs';

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
    getRepoName: async () => 'tfman',
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

describe('lib/ops/deps-generator', () => {
  it('a. extracts modules and lockfile providers', async t => {
    const result = await analyze(t);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.modules, ['modules/net']);
    assert.deepEqual(result.providers, [provider]);
    assert.deepEqual(result.logs, []);
  });

  it('b. fails when the modules command fails without a manifest', async t => {
    const result = await analyze(t, { modules: new Error('unsupported command') });
    assert.equal(result.status, 'error');
    assert.ok(result.logs.some(log => log.includes("'terraform modules' failed")));
  });

  it('c. falls back to the initialized modules manifest', async t => {
    const result = await analyze(t, { modules: new Error('unsupported command'), manifest: modulesJson });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.modules, ['modules/net']);
    assert.ok(result.logs.some(log => log.includes("'terraform modules' unavailable") && log.includes('used .terraform/modules/modules.json')));
  });

  it('d. fails on invalid command JSON without falling back', async t => {
    const result = await analyze(t, { modules: 'invalid json', manifest: modulesJson });
    assert.equal(result.status, 'error');
    assert.ok(result.logs.some(log => log.includes('JSON decode error')));
    assert.ok(result.logs.every(log => !log.includes('unavailable')));
  });

  it('e. fails when provider schema extraction fails', async t => {
    const result = await analyze(t, { lockfile: false, schema: new Error('schema failed') });
    assert.equal(result.status, 'error');
    assert.ok(result.logs.some(log => log.includes('Failed to get providers schema')));
  });

  it('f. extracts providers from the schema without a lockfile', async t => {
    const result = await analyze(t, { lockfile: false, schema: JSON.stringify({ provider_schemas: { [provider]: {} } }) });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.providers, [provider]);
  });

  it('fails on invalid manifest JSON', async t => {
    const result = await analyze(t, { modules: new Error('unsupported command'), manifest: 'invalid json' });
    assert.equal(result.status, 'error');
    assert.ok(result.logs.some(log => log.includes('JSON decode error')));
  });
});
