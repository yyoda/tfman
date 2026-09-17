import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/write-result.mjs';

describe('cli/commands/write-result', () => {
  const dependencies = { writeResult: async () => assert.fail('writeResult must not run for invalid arguments') };
  const args = { path: 'env/x', command: 'plan', outcome: 'cancelled' };
  it('rejects unsupported commands', async () => {
    await assert.rejects(run({ ...args, command: 'foo' }, dependencies), /--command must be plan or apply/);
  });
  for (const required of ['path', 'command', 'outcome']) {
    it(`requires ${required}`, async () => {
      await assert.rejects(run({ ...args, [required]: undefined }, dependencies), new RegExp(`Missing required arguments: ${required}`));
    });
  }
  it('defaults working directory and output paths from the environment', async () => {
    await run(args, {
      writeResult: async (options) => {
        assert.strictEqual(options.cwd, process.cwd());
        assert.strictEqual(options.summaryFile, process.env.GITHUB_STEP_SUMMARY);
        assert.strictEqual(options.githubOutput, process.env.GITHUB_OUTPUT);
        return { artifactName: 'plan-example' };
      },
    });
  });
});
