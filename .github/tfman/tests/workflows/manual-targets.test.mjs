import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cases = [
  { name: 'no resource targets', input: '', targets: [] },
  {
    name: 'literal indexes and quotes across multiple lines',
    input: '  aws_instance.web[0]\taws_instance.web["blue"]\n module.app[0].aws_instance.web[1]  ',
    targets: ['aws_instance.web[0]', 'aws_instance.web["blue"]', 'module.app[0].aws_instance.web[1]'],
  },
];

for (const command of ['plan', 'apply']) {
  describe(`ManualOps ${command} resource targets`, () => {
    for (const { name, input, targets } of cases) {
      it(`preserves ${name}`, async (t) => {
        const source = await readFile(new URL('../../../workflows/manual-ops.yml', import.meta.url), 'utf8');
        const label = command === 'plan' ? 'Plan' : 'Apply';
        const match = source.match(new RegExp(`      - name: Terraform ${label}\n[\\s\\S]*?        run: \\|\n([\\s\\S]*?)(?=\n      - |$)`));
        assert.ok(match, `workflow must contain the ${command} step`);
        const script = match[1].replace(/^          /gm, '');

        const workspace = await mkdtemp(join(tmpdir(), 'tfman manual targets '));
        t.after(() => rm(workspace, { recursive: true, force: true }));
        // These filenames would match the resource-address brackets if globbing were enabled.
        for (const filename of ['aws_instance.web0', 'aws_instance.webb', 'module.app0.aws_instance.web1']) {
          await writeFile(join(workspace, filename), '');
        }
        const output = join(workspace, 'terraform-arguments');
        // Capture argv with a shell function: never invoke the real Terraform executable.
        const capture = 'terraform() { printf "%s\\0" "$@" > "$CAPTURE_ARGUMENTS"; }\n';
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', capture + script], {
          cwd: workspace,
          env: { ...process.env, TF_TARGETS: input, ROLES: '["applier"]', ACTOR: 'test-user', CAPTURE_ARGUMENTS: output },
          encoding: 'utf8',
        });

        assert.equal(result.status, 0, result.stderr || String(result.error || 'step failed'));
        const flags = command === 'plan' ? ['-input=false'] : ['-auto-approve', '-input=false'];
        assert.deepEqual((await readFile(output, 'utf8')).split('\0').slice(0, -1), [
          command, ...flags, ...targets.map((target) => `-target=${target}`),
        ]);
      });
    }
  });
}
