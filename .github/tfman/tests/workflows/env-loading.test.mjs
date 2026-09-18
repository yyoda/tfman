import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflows = ['pr-review', 'pr-comment', 'manual-ops', 'drift-detection'];
const cases = [
  { name: 'missing file', content: null, expected: '' },
  { name: 'empty file', content: '', expected: '' },
  { name: 'comments and whitespace only', content: '# comment\n  # indented\n\t# tabbed\n\n \t\n', expected: '' },
  {
    name: 'values mixed with comments and whitespace',
    content: '# comment\nAWS_REGION=ap-northeast-1\n\n  # indented\nVALUE=with spaces # literal\nEMPTY=',
    expected: 'AWS_REGION=ap-northeast-1\nVALUE=with spaces # literal\nEMPTY=\n',
  },
];

for (const workflow of workflows) {
  describe(`${workflow} environment loading`, () => {
    for (const { name, content, expected } of cases) {
      it(`accepts ${name}`, async (t) => {
        const source = await readFile(new URL(`../../../workflows/${workflow}.yml`, import.meta.url), 'utf8');
        const match = source.match(/      - name: Load \.env\n        run: \|\n([\s\S]*?)(?=\n      - )/);
        assert.ok(match, 'workflow must contain the environment loading step');
        const script = match[1]
          .replace(/^          /gm, '')
          .replaceAll('${{ github.workspace }}', '${WORKSPACE}')
          .replaceAll('${{ matrix.path }}', '${TERRAFORM_ROOT}');

        const workspace = await mkdtemp(join(tmpdir(), 'tfman env loading '));
        t.after(() => rm(workspace, { recursive: true, force: true }));
        const root = 'environments/test';
        const envDir = join(workspace, '.github/env.d', root);
        await mkdir(envDir, { recursive: true });
        if (content !== null) await writeFile(join(envDir, '.env'), content);
        const output = join(workspace, 'github-env');
        await writeFile(output, 'EXISTING=preserved\n');

        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
          env: { ...process.env, WORKSPACE: workspace, TERRAFORM_ROOT: root, GITHUB_ENV: output },
          encoding: 'utf8',
        });

        assert.equal(result.status, 0, result.stderr || String(result.error || 'step failed'));
        assert.equal(await readFile(output, 'utf8'), `EXISTING=preserved\n${expected}`);
        if (content === null) assert.match(result.stdout, /\.env not found, skipping/);
      });
    }
  });
}
