import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactSlug, renderSummary, writeResult } from '../../../lib/ops/result-writer.mjs';

describe('lib/ops/result-writer', () => {
  it('hashes the exact path and replaces slashes', () => {
    const hash = createHash('sha256').update('environments/test1').digest('hex').slice(0, 8);
    assert.strictEqual(artifactSlug('environments/test1'), `environments-test1-${hash}`);
  });

  it('renders both commands and neutralizes every embedded fence', () => {
    assert.strictEqual(renderSummary({ path: 'env/x', command: 'plan', log: '```a```b```' }),
      '## 📄 Terraform Plan — `env/x`\n\n```hcl\n~~~a~~~b~~~\n```\n');
    assert.strictEqual(renderSummary({ path: 'env/x', command: 'apply', log: 'ok' }),
      '## 📄 Terraform Apply — `env/x`\n\n```text\nok\n```\n');
  });

  it('caps log content at 900000 bytes, preserving UTF-8 characters', () => {
    for (const [log, expected] of [
      ['a'.repeat(900001), 'a'.repeat(900000)],
      ['a' + '€'.repeat(300000), 'a' + '€'.repeat(299999)],
    ]) {
      const summary = renderSummary({ path: 'x', command: 'plan', log });
      const content = summary.split('```hcl\n')[1].slice(0, -5);
      assert.strictEqual(content, expected);
      assert.ok(Buffer.byteLength(content) <= 900000);
    }
  });

  it('normalizes outcomes, appends existing logs and writes artifact outputs', async (t) => {
    const cwd = await fs.mkdtemp(join(tmpdir(), 'result-writer-'));
    t.after(() => fs.rm(cwd, { recursive: true, force: true }));
    const summaryFile = join(cwd, 'summary.md');
    const githubOutput = join(cwd, 'output');
    await fs.writeFile(summaryFile, 'existing\n');
    for (const outcome of ['cancelled', 'skipped', 'failure', 'success']) {
      const result = await writeResult({ cwd, path: 'env/x', command: 'plan', outcome, summaryFile, githubOutput });
      assert.strictEqual(result.logExists, false);
      assert.strictEqual(await fs.readFile(join(cwd, 'info.json'), 'utf8'),
        JSON.stringify({ path: 'env/x', outcome: outcome === 'success' ? 'success' : 'failure' }) + '\n');
    }
    assert.strictEqual(await fs.readFile(summaryFile, 'utf8'), 'existing\n');
    await fs.writeFile(join(cwd, 'plan.txt'), '```test');
    const result = await writeResult({ cwd, path: 'env/x', command: 'plan', outcome: 'success', summaryFile, githubOutput });
    assert.deepStrictEqual(result, { cleanPath: artifactSlug('env/x'), artifactName: `plan-${artifactSlug('env/x')}`, logExists: true });
    assert.strictEqual(await fs.readFile(summaryFile, 'utf8'), 'existing\n' + renderSummary({ path: 'env/x', command: 'plan', log: '```test' }));
    assert.strictEqual(await fs.readFile(githubOutput, 'utf8'), `clean_path=${result.cleanPath}\nartifact_name=${result.artifactName}\n`.repeat(5));
    await fs.writeFile(join(cwd, 'apply.txt'), 'applied');
    assert.strictEqual((await writeResult({ cwd, path: 'env/x', command: 'apply', outcome: 'success', summaryFile: '', githubOutput: '' })).logExists, true);
  });
});
